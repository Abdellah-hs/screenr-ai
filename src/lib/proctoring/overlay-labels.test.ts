import { describe, expect, it } from "vitest";
import { displayLabels, type OverlayBox } from "./overlay";

function box(label: OverlayBox["label"], w: number, h: number): OverlayBox {
  return { label, x: 0, y: 0, w, h, score: 0.9 };
}

describe("displayLabels", () => {
  it("names the largest person as the candidate and the rest as second faces", () => {
    expect(
      displayLabels([box("person", 0.1, 0.1), box("person", 0.3, 0.4), box("person", 0.2, 0.2)]),
    ).toEqual(["second_face", "face", "second_face"]);
  });

  it("leaves phones alone — they are never a face", () => {
    expect(displayLabels([box("phone", 0.5, 0.5), box("person", 0.1, 0.1)])).toEqual([
      "phone",
      "face",
    ]);
  });

  it("names a lone person the candidate however small they are", () => {
    expect(displayLabels([box("person", 0.01, 0.01)])).toEqual(["face"]);
  });

  it("returns one label per box, always", () => {
    const boxes = [box("person", 0.2, 0.2), box("phone", 0.1, 0.1), box("person", 0.3, 0.3)];

    expect(displayLabels(boxes)).toHaveLength(boxes.length);
  });

  it("handles a frame with nothing in it", () => {
    expect(displayLabels([])).toEqual([]);
  });

  it("never calls a phone-only frame a face", () => {
    expect(displayLabels([box("phone", 0.4, 0.4)])).toEqual(["phone"]);
  });
});
