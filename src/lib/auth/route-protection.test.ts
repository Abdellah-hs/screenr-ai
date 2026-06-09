import { describe, it, expect } from "vitest";
import { isProtectedPath } from "./route-protection";

describe("isProtectedPath", () => {
  it("protects campaign pages and their sub-paths", () => {
    expect(isProtectedPath("/campaigns")).toBe(true);
    expect(isProtectedPath("/campaigns/123/candidates/456")).toBe(true);
  });

  it("protects admin pages", () => {
    expect(isProtectedPath("/admin/duplicates")).toBe(true);
  });

  it("protects settings (regression: previously 500'd when unauthenticated)", () => {
    expect(isProtectedPath("/settings")).toBe(true);
    expect(isProtectedPath("/settings/integrations")).toBe(true);
  });

  it("leaves auth and public pages open", () => {
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/signup")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/respond/some-token")).toBe(false);
  });

  it("does not match prefix look-alikes", () => {
    expect(isProtectedPath("/settings-export")).toBe(false);
    expect(isProtectedPath("/campaigns-public")).toBe(false);
  });
});
