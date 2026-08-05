import { describe, it, expect } from "vitest";
import { createSamWorkerClient, type WorkerLike } from "./samWorkerClient";

class FakeWorker implements WorkerLike {
  sent: unknown[] = [];
  terminated = false;
  private listeners: Array<(event: { data: unknown }) => void> = [];

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: { data: unknown }) => void
  ): void {
    this.listeners = this.listeners.filter((registered) => registered !== listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data });
    }
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
});
