import type { Application } from "express";
import { describe, expect, it, vi } from "vitest";
import { LOOPBACK_HOST, startServer } from "../src/server";

// 検知/理由: codex レビュー指摘（`app.listen(PORT)` はホスト省略で全インターフェースに
// bindしてしまい、共有LAN上の第三者が認証なしで推論を叩けてしまう）への対応を検証する。
// 実ポートを開かず、`app.listen` の呼び出し引数（host）だけを fake app で確認する。
describe("startServer", () => {
  it("追加: app.listenをループバックアドレス(127.0.0.1)固定で呼び出す", () => {
    const listen = vi.fn(
      (_port: number, _host: string, callback?: () => void): ReturnType<Application["listen"]> => {
        callback?.();
        return {} as ReturnType<Application["listen"]>;
      }
    );
    const fakeApp = { listen } as unknown as Application;

    startServer(fakeApp, 12345);

    expect(LOOPBACK_HOST).toBe("127.0.0.1");
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen.mock.calls[0][0]).toBe(12345);
    expect(listen.mock.calls[0][1]).toBe("127.0.0.1");
    expect(typeof listen.mock.calls[0][2]).toBe("function");
  });
});
