import { describe, it, expect } from "vitest";
import { createEdgeSamWorkerClient, type WorkerLike } from "./edgeSamWorkerClient";

type FakeWorkerEventType = "message" | "error" | "messageerror";

class FakeWorker implements WorkerLike {
  sent: unknown[] = [];
  terminated = false;
  removedListenerTypes: FakeWorkerEventType[] = [];
  private listeners: Map<FakeWorkerEventType, Array<(event: { data: unknown }) => void>> =
    new Map();

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  addEventListener(
    type: FakeWorkerEventType,
    listener: (event: { data: unknown }) => void
  ): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(
    type: FakeWorkerEventType,
    listener: (event: { data: unknown }) => void
  ): void {
    this.removedListenerTypes.push(type);
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((registered) => registered !== listener)
    );
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data });
    }
  }

  emitError(): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ data: undefined });
    }
  }

  emitMessageError(): void {
    for (const listener of this.listeners.get("messageerror") ?? []) {
      listener({ data: undefined });
    }
  }

  registeredTypes(): FakeWorkerEventType[] {
    return Array.from(this.listeners.keys()).filter(
      (type) => (this.listeners.get(type) ?? []).length > 0
    );
  }
}

const IMAGE = { data: new Uint8ClampedArray(16), width: 2, height: 2 };

describe("createEdgeSamWorkerClient", () => {
  it("setImage は postMessage し、result 応答で resolve される", async () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker, () => "req-1");

    const promise = client.setImage(IMAGE);

    expect(worker.sent[0]).toEqual({ id: "req-1", type: "setImage", image: IMAGE });

    worker.emit({ id: "req-1", type: "result", payload: undefined });

    await expect(promise).resolves.toBeUndefined();
  });

  it("segmentAtPoint は postMessage し、result 応答のマスクで resolve される", async () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker, () => "req-1");

    const promise = client.segmentAtPoint(1, 2);

    expect(worker.sent[0]).toEqual({ id: "req-1", type: "segmentAtPoint", x: 1, y: 2 });

    const mask = { data: new Uint8Array([1, 0, 0, 1]), width: 2, height: 2, score: 0.9 };
    worker.emit({ id: "req-1", type: "result", payload: mask });

    await expect(promise).resolves.toEqual(mask);
  });

  it("応答が来ていない複数リクエストは id で相関する（順不同でも取り違えない）", async () => {
    const worker = new FakeWorker();
    const ids = ["r1", "r2"];
    let callIndex = 0;
    const client = createEdgeSamWorkerClient(worker, () => ids[callIndex++]);

    const first = client.segmentAtPoint(1, 1);
    const second = client.segmentAtPoint(2, 2);

    worker.emit({
      id: "r2",
      type: "result",
      payload: { data: new Uint8Array([1]), width: 1, height: 1, score: 0.5 },
    });
    worker.emit({
      id: "r1",
      type: "result",
      payload: { data: new Uint8Array([0]), width: 1, height: 1, score: 0.1 },
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.score).toBe(0.1);
    expect(secondResult.score).toBe(0.5);
  });

  it("error 応答は対応する promise を reject する", async () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker, () => "e1");

    const request = client.segmentAtPoint(0, 0);
    worker.emit({ id: "e1", type: "error", name: "EdgeSamNoImageError", message: "x" });

    await expect(request).rejects.toMatchObject({
      name: "EdgeSamNoImageError",
      message: "x",
    });
  });

  it("terminate は pending 中のリクエストを reject し worker.terminate() を呼ぶ", async () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker, () => "t1");

    const request = client.segmentAtPoint(0, 0);
    client.terminate();

    await expect(request).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it("terminate は登録済みリスナーを全て解除する", () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker);

    expect(worker.registeredTypes().sort()).toEqual(["error", "message", "messageerror"]);

    client.terminate();

    expect(worker.registeredTypes()).toEqual([]);
    expect(worker.removedListenerTypes.sort()).toEqual([
      "error",
      "message",
      "messageerror",
    ]);
  });

  it("worker の error イベントで pending request が reject される", async () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker, () => "req-1");

    const request = client.segmentAtPoint(0, 0);
    worker.emitError();

    await expect(request).rejects.toThrow();
  });

  it("messageerror イベントでも pending request が reject される", async () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker, () => "req-1");

    const request = client.segmentAtPoint(0, 0);
    worker.emitMessageError();

    await expect(request).rejects.toThrow();
  });

  it("worker クラッシュ後に発行したリクエストは即座に reject され postMessage されない", async () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker, () => "req-1");

    worker.emitError();
    const sentCountAfterCrash = worker.sent.length;

    const request = client.segmentAtPoint(0, 0);

    await expect(request).rejects.toThrow();
    expect(worker.sent.length).toBe(sentCountAfterCrash);
  });

  it("idFactory 省略時もデフォルトで動作しリクエストごとに一意な id が振られる", () => {
    const worker = new FakeWorker();
    const client = createEdgeSamWorkerClient(worker);

    void client.segmentAtPoint(0, 0);
    void client.segmentAtPoint(1, 1);

    const ids = worker.sent.map((message) => (message as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });
});
