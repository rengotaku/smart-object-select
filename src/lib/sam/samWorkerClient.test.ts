import { describe, it, expect, vi } from "vitest";
import { createSamWorkerClient, type WorkerLike } from "./samWorkerClient";
import type { SamProgressEvent } from "./protocol";

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
      payload: [{ width: 2, height: 2, score: 0.5, data: new Uint8Array([1]) }],
    });
    worker.emit({
      id: "r1",
      type: "result",
      payload: [{ width: 1, height: 1, score: 0.1, data: new Uint8Array([0]) }],
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult[0].score).toBe(0.1);
    expect(secondResult[0].score).toBe(0.5);
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

  it("Case 25: worker クラッシュ後に発行したリクエストは即座に reject される", async () => {
    const worker = new FakeWorker();
    const ids = ["init1", "seg1"];
    let callIndex = 0;
    const client = createSamWorkerClient(worker, () => ids[callIndex++]);

    const initRequest = client.init();
    worker.emit({ id: "init1", type: "result", payload: "cpu" });
    await initRequest;

    const sentCountBeforeCrash = worker.sent.length;

    worker.emitError();

    const segmentRequest = client.segment(1, 1);

    await expect(segmentRequest).rejects.toThrow();
    expect(worker.sent.length).toBe(sentCountBeforeCrash);
  });

  it("Case 26: terminate 後に発行したリクエストも即座に reject される", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "seg1");

    client.terminate();

    const sentCountAfterTerminate = worker.sent.length;

    const segmentRequest = client.segment(1, 1);

    await expect(segmentRequest).rejects.toThrow();
    expect(worker.sent.length).toBe(sentCountAfterTerminate);
  });

  it("segmentAtPoints のリクエストが正しく postMessage されレスポンスで resolve される", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "sp1");

    const points = [
      { x: 10, y: 20, label: 1 as const },
      { x: 30, y: 40, label: 0 as const },
    ];
    const promise = client.segmentAtPoints(points);

    expect(worker.sent[0]).toEqual({
      id: "sp1",
      type: "segmentAtPoints",
      points,
    });

    const fakeMasks = [
      {
        width: 2,
        height: 2,
        score: 0.95,
        data: new Uint8Array([1, 0, 0, 1]),
      },
    ];
    worker.emit({
      id: "sp1",
      type: "result",
      payload: fakeMasks,
    });

    const result = await promise;
    expect(result).toEqual(fakeMasks);
  });

  it("Case 1: 進捗通知が subscriber に伝播する", () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "id1");
    const received: SamProgressEvent[] = [];

    client.onProgress((progress) => {
      received.push(progress);
    });

    worker.emit({ type: "progress", file: "model.onnx", loaded: 10, total: 100 });

    expect(received).toEqual([{ file: "model.onnx", loaded: 10, total: 100 }]);
  });

  it("Case 2: id 相関の request/response は progress 通知の影響を受けない", async () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "seg1");
    const progressListener = vi.fn();
    client.onProgress(progressListener);

    const promise = client.segment(1, 1);

    worker.emit({ type: "progress", file: "model.onnx", loaded: 1, total: 100 });
    worker.emit({ type: "progress", file: "model.onnx", loaded: 2, total: 100 });

    const fakeMasks = [{ width: 1, height: 1, score: 1, data: new Uint8Array([1]) }];
    worker.emit({ id: "seg1", type: "result", payload: fakeMasks });

    const result = await promise;

    expect(result).toEqual(fakeMasks);
    expect(progressListener).toHaveBeenCalledTimes(2);
  });

  it("Case 3: subscribe していない状態で progress 通知が来ても例外を投げない", () => {
    const worker = new FakeWorker();
    createSamWorkerClient(worker, () => "id2");

    expect(() => {
      worker.emit({ type: "progress", file: "model.onnx", loaded: 1, total: 100 });
    }).not.toThrow();
  });

  it("Case 4: unsubscribe 後は通知が届かない", () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "id3");
    const listener = vi.fn();

    const unsubscribe = client.onProgress(listener);
    unsubscribe();

    worker.emit({ type: "progress", file: "model.onnx", loaded: 1, total: 100 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("追加: total が不明（0）な progress 通知は total: null として通知される", () => {
    const worker = new FakeWorker();
    const client = createSamWorkerClient(worker, () => "id4");
    const received: SamProgressEvent[] = [];

    client.onProgress((progress) => {
      received.push(progress);
    });

    worker.emit({ type: "progress", file: "model.onnx", loaded: 5, total: null });

    expect(received).toEqual([{ file: "model.onnx", loaded: 5, total: null }]);
  });
});
