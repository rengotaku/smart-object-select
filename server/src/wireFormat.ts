import type { SamImageInput, SamMaskResult, SegmentPoint } from "../../src/lib/sam/types";

/**
 * HTTP JSON ボディとドメイン型（`SamImageInput` / `SegmentPoint` / `SamMaskResult`）の
 * 相互変換。バイト列（RGBA 画像・二値マスク）は base64 文字列としてやり取りする。
 */

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function requireField(body: Record<string, unknown>, field: string): unknown {
  if (!(field in body) || body[field] === undefined) {
    throw new RequestValidationError(`missing required field: "${field}"`);
  }
  return body[field];
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestValidationError(`field "${field}" must be a finite number`);
  }
  return value;
}

/**
 * 画像1辺あたりの許容最大ピクセル数。この上限が無いと巨大な width/height を送りつけられ
 * `width * height * 4` バイトの確保やデコードでメモリを圧迫しうる（codex レビュー指摘）。
 */
export const MAX_IMAGE_DIMENSION_PX = 8192;

function requirePositiveInt(value: unknown, field: string, max: number): number {
  const num = requireNumber(value, field);
  if (!Number.isInteger(num) || num <= 0) {
    throw new RequestValidationError(`field "${field}" must be a positive integer`);
  }
  if (num > max) {
    throw new RequestValidationError(`field "${field}" must not exceed ${max}`);
  }
  return num;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new RequestValidationError(`field "${field}" must be a string`);
  }
  return value;
}

export interface SessionCreateBody {
  image: {
    data: string; // base64 encoded RGBA bytes
    width: number;
    height: number;
  };
}

export function decodeImagePayload(body: unknown): SamImageInput {
  if (typeof body !== "object" || body === null) {
    throw new RequestValidationError("request body must be a JSON object");
  }
  const image = requireField(body as Record<string, unknown>, "image");
  if (typeof image !== "object" || image === null) {
    throw new RequestValidationError('field "image" must be an object');
  }
  const imageBody = image as Record<string, unknown>;
  const data = requireString(requireField(imageBody, "data"), "image.data");
  const width = requirePositiveInt(
    requireField(imageBody, "width"),
    "image.width",
    MAX_IMAGE_DIMENSION_PX
  );
  const height = requirePositiveInt(
    requireField(imageBody, "height"),
    "image.height",
    MAX_IMAGE_DIMENSION_PX
  );

  const buffer = Buffer.from(data, "base64");
  const expectedByteLength = width * height * 4;
  if (buffer.byteLength !== expectedByteLength) {
    throw new RequestValidationError(
      `field "image.data" decoded length (${buffer.byteLength} bytes) does not match ` +
        `width*height*4 (${expectedByteLength} bytes) for width=${width}, height=${height}`
    );
  }

  return {
    data: new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    width,
    height,
  };
}

/**
 * `POST /sessions` の任意フィールド `modelId` を検証する。省略時は `undefined`
 * （呼び出し元 `sessionStore.create` が既定 runtime にフォールバックする）。
 *
 * `availableModelIds` に無い値を指定された場合は 400 を返す（codex レビュー指摘対応:
 * 未知の modelId をサイレントに既定モデルへフォールバックさせず、明示的にエラーにする）。
 */
export function decodeModelId(body: unknown, availableModelIds: readonly string[]): string | undefined {
  if (typeof body !== "object" || body === null) {
    throw new RequestValidationError("request body must be a JSON object");
  }
  const raw = (body as Record<string, unknown>).modelId;
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new RequestValidationError('field "modelId" must be a string');
  }
  if (!availableModelIds.includes(raw)) {
    throw new RequestValidationError(`unknown modelId: "${raw}"`);
  }
  return raw;
}

export function decodePointsPayload(body: unknown): SegmentPoint[] {
  if (typeof body !== "object" || body === null) {
    throw new RequestValidationError("request body must be a JSON object");
  }
  const points = requireField(body as Record<string, unknown>, "points");
  if (!Array.isArray(points)) {
    throw new RequestValidationError('field "points" must be an array');
  }

  return points.map((point, index) => {
    if (typeof point !== "object" || point === null) {
      throw new RequestValidationError(`points[${index}] must be an object`);
    }
    const p = point as Record<string, unknown>;
    const x = requireNumber(requireField(p, "x"), `points[${index}].x`);
    const y = requireNumber(requireField(p, "y"), `points[${index}].y`);
    const label = requireField(p, "label");
    if (label !== 0 && label !== 1) {
      throw new RequestValidationError(`points[${index}].label must be 0 or 1`);
    }
    return { x, y, label };
  });
}

export interface WireMaskResult {
  data: string; // base64 encoded Uint8Array (0/1 per pixel)
  width: number;
  height: number;
  score: number;
}

export function encodeMask(mask: SamMaskResult): WireMaskResult {
  return {
    data: Buffer.from(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength).toString(
      "base64"
    ),
    width: mask.width,
    height: mask.height,
    score: mask.score,
  };
}

export function encodeMasks(masks: SamMaskResult[]): WireMaskResult[] {
  return masks.map(encodeMask);
}
