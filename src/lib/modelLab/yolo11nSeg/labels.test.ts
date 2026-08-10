import { describe, it, expect } from "vitest";
import { COCO_CLASSES, COCO_CLASS_COUNT } from "./labels";

describe("COCO_CLASSES", () => {
  it("COCOの80クラスを含む", () => {
    expect(COCO_CLASSES).toHaveLength(80);
    expect(COCO_CLASS_COUNT).toBe(80);
  });

  it("先頭は person, 末尾は toothbrush（Ultralytics の学習時クラス順序）", () => {
    expect(COCO_CLASSES[0]).toBe("person");
    expect(COCO_CLASSES.at(-1)).toBe("toothbrush");
  });

  it("重複するラベルが無い", () => {
    expect(new Set(COCO_CLASSES).size).toBe(COCO_CLASSES.length);
  });
});
