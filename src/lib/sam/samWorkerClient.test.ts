import { describe, it, expect } from "vitest";
import { createSamWorkerClient, type WorkerLike } from "./samWorkerClient";

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

describe("createSamWorkerClient", () => {
  it("Case 15: responses arriving out of order are correlated by id", async () => {
    const worker = new FakeWorker();
    const ids = ["r1", "r2"];
    let callIndex = 0;
    const client = createSamWorkerClient(worker, () => ids[callIndex++]);

    const first = client.segment(1, 1);
    const second = client.segment(2, 2);

    worker.emit({
      id: "r2",
      type: "result",
      payload: { width: 2, height: 2, score: 0.5, data: new Uint8Array([1]) },
    });
    worker.emit({
      id: "r1",
      type: "result",
      payload: { width: 1, height: 1, score: 0.1, data: new Uint8Array([0]) },
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.score).toBe(0.1);
    expect(secondResult.score).toBe(0.5);
  });

  it("Case 16: an error response rejects the associated promise", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "e1");

    const request = client.segment(1, 1);
    worker.emit({ id: "e1", type: "error", name: "SamNoImageError", message: "x" });

    await expect(request).rejects.toMatchObject({
      name: "SamNoImageError",
      message: "x",
    });
  });

  it("Case 16: terminate rejects still-pending requests instead of leaving them hanging", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "t1");

    const request = client.segment(1, 1);
    client.terminate();

    await expect(request).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it("追加: idFactory 省略時もデフォルトで動作しリクエストごとに一意な id が振られる", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker);

    void client.init();
    void client.init();

    const ids = worker.sent.map((message) => (message as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it("Case 21: worker の error イベントで pending request が reject される", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "init1");

    const request = client.init();
    worker.emitError();

    await expect(request).rejects.toThrow();
  });

  it("Case 22: messageerror イベントでも pending request が reject される", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "seg1");

    const request = client.segment(1, 1);
    worker.emitMessageError();

    await expect(request).rejects.toThrow();
  });

  it("Case 23: terminate 後に登録リスナーが全て解除される", () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker);

    expect(worker.registeredTypes().sort()).toEqual(["error", "message", "messageerror"]);

    client.terminate();

    expect(worker.registeredTypes()).toEqual([]);
    expect(worker.removedListenerTypes.sort()).toEqual([
      "error",
      "message",
      "messageerror",
    ]);
  });
});
