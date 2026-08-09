import { describe, expect, it } from "vitest";
import {
  decodeImagePayload,
  decodeModelId,
  MAX_IMAGE_DIMENSION_PX,
  RequestValidationError,
} from "../src/wireFormat";

function base64OfLength(byteLength: number): string {
  return Buffer.from(new Uint8Array(byteLength)).toString("base64");
}

// 検知/理由: codex レビュー指摘（width/height の型チェックのみで、負数・小数・ゼロや
// 上限超過、RGBAデータ長の不一致を許してしまう）への対応をユニットレベルで検証する。
describe("decodeImagePayload バリデーション", () => {
  it("追加: widthが0だとRequestValidationErrorになる", () => {
    expect(() =>
      decodeImagePayload({ image: { data: base64OfLength(16), width: 0, height: 2 } })
    ).toThrow(RequestValidationError);
  });

  it("追加: widthが負数だとRequestValidationErrorになる", () => {
    expect(() =>
      decodeImagePayload({ image: { data: base64OfLength(16), width: -1, height: 2 } })
    ).toThrow(RequestValidationError);
  });

  it("追加: widthが小数だとRequestValidationErrorになる", () => {
    expect(() =>
      decodeImagePayload({ image: { data: base64OfLength(16), width: 2.5, height: 2 } })
    ).toThrow(RequestValidationError);
  });

  it("追加: widthが上限を超えるとRequestValidationErrorになる", () => {
    expect(() =>
      decodeImagePayload({
        image: { data: base64OfLength(16), width: MAX_IMAGE_DIMENSION_PX + 1, height: 2 },
      })
    ).toThrow(RequestValidationError);
  });

  it("追加: base64復号後のデータ長がwidth*height*4と一致しないとRequestValidationErrorになる", () => {
    expect(() =>
      // 2x2のRGBAは16バイト必要だが4バイトしか渡さない
      decodeImagePayload({ image: { data: base64OfLength(4), width: 2, height: 2 } })
    ).toThrow(RequestValidationError);
  });

  it("正常系: width*height*4と一致するデータ長なら成功する", () => {
    const result = decodeImagePayload({
      image: { data: base64OfLength(16), width: 2, height: 2 },
    });

    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.data.byteLength).toBe(16);
  });
});

// 検知/理由: codex レビュー指摘（未知の modelId をサイレントに既定モデルへフォールバック
// させると、選択したモデルと実際に推論に使われるモデルが不整合になる）への対応を
// ユニットレベルで検証する。
describe("decodeModelId バリデーション", () => {
  const AVAILABLE_MODEL_IDS = ["model-a", "model-b"];

  it("追加: modelId が未指定なら undefined を返す", () => {
    expect(decodeModelId({}, AVAILABLE_MODEL_IDS)).toBeUndefined();
  });

  it("追加: 利用可能な modelId ならそのまま返す", () => {
    expect(decodeModelId({ modelId: "model-b" }, AVAILABLE_MODEL_IDS)).toBe("model-b");
  });

  it("追加: 利用可能な一覧に無い modelId は RequestValidationError になる", () => {
    expect(() => decodeModelId({ modelId: "unknown-model" }, AVAILABLE_MODEL_IDS)).toThrow(
      RequestValidationError
    );
  });

  it("追加: modelId が文字列でない場合は RequestValidationError になる", () => {
    expect(() => decodeModelId({ modelId: 123 }, AVAILABLE_MODEL_IDS)).toThrow(
      RequestValidationError
    );
  });

  it("追加: body がオブジェクトでない場合は RequestValidationError になる", () => {
    expect(() => decodeModelId(null, AVAILABLE_MODEL_IDS)).toThrow(RequestValidationError);
  });
});
