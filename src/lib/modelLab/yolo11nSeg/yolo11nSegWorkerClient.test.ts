import { describe, it, expect } from "vitest";
import { createYolo11nSegWorkerClient, type WorkerLike } from "./yolo11nSegWorkerClient";

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

describe("createYolo11nSegWorkerClient", () => {
  it("detect は postMessage し、result 応答の検出結果で resolve される", async () => {
    const worker = new FakeWorker();
    const client = createYolo11nSegWorkerClient(worker, () => "req-1");

    const promise = client.detect(IMAGE);

    expect(worker.sent[0]).toEqual({ id: "req-1", type: "detect", image: IMAGE });

    const detections = [
      {
        classId: 0,
        label: "person",
        score: 0.9,
        box: { x: 0, y: 0, width: 2, height: 2 },
        mask: { data: new Uint8Array([1, 0, 0, 1]), width: 2, height: 2, x: 0, y: 0 },
      },
    ];
    worker.emit({ id: "req-1", type: "result", payload: detections });

    await expect(promise).resolves.toEqual(detections);
  });

  it("応答が来ていない複数リクエストは id で相関する（順不同でも取り違えない）", async () => {
    const worker = new FakeWorker();
    const ids = ["r1", "r2"];
    let callIndex = 0;
    const client = createYolo11nSegWorkerClient(worker, () => ids[callIndex++]);

    const first = client.detect(IMAGE);
    const second = client.detect(IMAGE);

    worker.emit({ id: "r2", type: "result", payload: [{ classId: 1 }] });
    worker.emit({ id: "r1", type: "result", payload: [{ classId: 0 }] });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect((firstResult[0] as { classId: number }).classId).toBe(0);
    expect((secondResult[0] as { classId: number }).classId).toBe(1);
  });

  it("error 応答は対応する promise を reject する", async () => {
    const worker = new FakeWorker();
    const client = createYolo11nSegWorkerClient(worker, () => "e1");

    const request = client.detect(IMAGE);
    worker.emit({ id: "e1", type: "error", name: "Error", message: "detect failed" });

    await expect(request).rejects.toMatchObject({ message: "detect failed" });
  });

  it("terminate は pending 中のリクエストを reject し worker.terminate() を呼ぶ", async () => {
    const worker = new FakeWorker();
    const client = createYolo11nSegWorkerClient(worker, () => "t1");

    const request = client.detect(IMAGE);
    client.terminate();

    await expect(request).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it("terminate は登録済みリスナーを全て解除する", () => {
    const worker = new FakeWorker();
    const client = createYolo11nSegWorkerClient(worker);

    expect(worker.registeredTypes().sort()).toEqual(["error", "message", "messageerror"]);

    client.terminate();

    expect(worker.registeredTypes()).toEqual([]);
  });

  it("worker の error イベントで pending request が reject される", async () => {
    const worker = new FakeWorker();
    const client = createYolo11nSegWorkerClient(worker, () => "req-1");

    const request = client.detect(IMAGE);
    worker.emitError();

    await expect(request).rejects.toThrow();
  });

  it("messageerror イベントでも pending request が reject される", async () => {
    const worker = new FakeWorker();
    const client = createYolo11nSegWorkerClient(worker, () => "req-1");

    const request = client.detect(IMAGE);
    worker.emitMessageError();

    await expect(request).rejects.toThrow();
  });

  it("idFactory 省略時もデフォルトで動作しリクエストごとに一意な id が振られる", () => {
    const worker = new FakeWorker();
    const client = createYolo11nSegWorkerClient(worker);

    void client.detect(IMAGE);
    void client.detect(IMAGE);

    const ids = worker.sent.map((message) => (message as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });
});
