import { describe, expect, it, vi } from "vitest";

const { mockExtractRawText } = vi.hoisted(() => ({
  mockExtractRawText: vi.fn(),
}));

vi.mock("mammoth", () => ({
  default: { extractRawText: mockExtractRawText },
}));

import { parseDocx } from "./docx";

describe("parseDocx", () => {
  it("returns extracted text from a DOCX buffer", async () => {
    const buffer = Buffer.from("fake-docx");
    mockExtractRawText.mockResolvedValue({ value: "Hello DOCX" });

    const result = await parseDocx(buffer);

    expect(result).toBe("Hello DOCX");
    expect(mockExtractRawText).toHaveBeenCalledWith({ buffer });
  });

  it("propagates mammoth errors", async () => {
    const buffer = Buffer.from("fake-docx");
    mockExtractRawText.mockRejectedValue(new Error("corrupted file"));

    await expect(parseDocx(buffer)).rejects.toThrow("corrupted file");
  });
});
