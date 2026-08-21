import { describe, expect, it } from "vitest";
import { classifyStartFailure } from "./interview-diagnostics";

/** getUserMedia rejects with a DOMException; `name` is the specified part. */
function domError(name: string, message = "boom"): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("classifyStartFailure", () => {
  it("reads the exception name, not its message — messages are localised", () => {
    expect(classifyStartFailure(domError("NotAllowedError", "Erlaubnis verweigert")).kind).toBe(
      "permission",
    );
  });

  it("separates a blocked camera from a missing one — the fixes differ", () => {
    expect(classifyStartFailure(domError("NotAllowedError")).kind).toBe("permission");
    expect(classifyStartFailure(domError("NotFoundError")).kind).toBe("no_camera");
    expect(classifyStartFailure(domError("NotReadableError")).kind).toBe("no_camera");
  });

  it("lets the caller name a kind it already knows", () => {
    expect(classifyStartFailure(null, "interviewer").kind).toBe("interviewer");
    expect(classifyStartFailure(domError("NotAllowedError"), "insecure").kind).toBe("insecure");
  });

  it("does not offer a retry that cannot work without leaving the page", () => {
    expect(classifyStartFailure(null, "insecure").retry).toBe(false);
    expect(classifyStartFailure(null, "permission").retry).toBe(true);
  });

  it("never blames the candidate for our own failure", () => {
    expect(classifyStartFailure(null, "interviewer").body).toContain("not your connection");
    expect(classifyStartFailure(null, "interviewer").body).toContain("won't count against you");
  });

  it("falls back without losing the detail, and still offers a way forward", () => {
    const failure = classifyStartFailure(new Error("websocket closed"));

    expect(failure.kind).toBe("unknown");
    expect(failure.body).toContain("websocket closed");
    expect(failure.retry).toBe(true);
  });

  it("survives a thrown non-Error", () => {
    expect(classifyStartFailure("nope").kind).toBe("unknown");
    expect(classifyStartFailure(undefined).title.length).toBeGreaterThan(0);
  });
});
