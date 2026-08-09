import { describe, expect, it } from "vitest";
import { decodeImagePayload, MAX_IMAGE_DIMENSION_PX, RequestValidationError } from "../src/wireFormat";

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
