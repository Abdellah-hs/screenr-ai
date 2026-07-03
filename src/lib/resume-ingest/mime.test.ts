import { describe, it, expect } from "vitest";
import { isSupportedResumeMimeType } from "./mime";

describe("isSupportedResumeMimeType", () => {
  it("returns true for application/pdf", () => {
    expect(isSupportedResumeMimeType("application/pdf")).toBe(true);
  });

  it("returns true for the DOCX OOXML mime type", () => {
    expect(
      isSupportedResumeMimeType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe(true);
  });

  it("returns false for legacy .doc (application/msword)", () => {
    expect(isSupportedResumeMimeType("application/msword")).toBe(false);
  });

  it("returns false for unrelated mime types", () => {
    expect(isSupportedResumeMimeType("image/png")).toBe(false);
    expect(isSupportedResumeMimeType("text/plain")).toBe(false);
    expect(isSupportedResumeMimeType("")).toBe(false);
  });
});
