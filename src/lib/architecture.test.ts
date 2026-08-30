import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The layering rules CLAUDE.md calls non-negotiable, asserted against the
 * source rather than trusted to review.
 *
 * Every rule here is one that has already been broken at least once, and each
 * broke silently: nothing failed, nothing typechecked wrong, and the damage was
 * only visible to somebody who happened to read the imports. A boundary that is
 * only a convention is one that erodes, so the boundaries that matter are
 * tested like any other behaviour.
 */

const LIB = join(process.cwd(), "src", "lib");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (entry.name.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

/** Every `@/lib/...` specifier this file imports from. */
function libImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/from\s+"(@\/lib\/[^"]+)"/g)].map((m) => m[1]);
}

function rel(file: string): string {
  return file.slice(process.cwd().length + 1).replace(/\\/g, "/");
}

/** Report every offending (file, import) pair, so one run names them all. */
function offenders(dir: string, forbidden: RegExp): string[] {
  return sourceFiles(join(LIB, dir)).flatMap((file) =>
    libImports(file)
      .filter((spec) => forbidden.test(spec))
      .map((spec) => `${rel(file)} imports ${spec}`),
  );
}

describe("the rules layer decides and touches nothing", () => {
  /**
   * A rule that can read the database or call a service is a rule that can be
   * given different evidence than the action thought it was handing over, and
   * one that can `revalidatePath` is one that has started executing its own
   * decision. `src/lib/rules/README.md` states the contract; this enforces it.
   */
  it("imports no data, service, action or supabase module", () => {
    expect(offenders("rules", /^@\/lib\/(supabase|actions|data|services)\b/)).toEqual([]);
  });
});

describe("the pure domain packages never reach I/O", () => {
  const PURE = [
    "resume-scoring",
    "screening-scoring",
    "interview-scoring",
    "scoring",
    "proctoring",
    "talent-pool",
  ];

  /**
   * These are the versioned scoring packages. Their whole value is that the
   * same evidence always produces the same number, which stops being true the
   * moment one of them can read a clock, a database or a model.
   */
  it.each(PURE)("%s imports no service, action or supabase module", (pkg) => {
    expect(offenders(pkg, /^@\/lib\/(supabase|actions|services)\b/)).toEqual([]);
  });
});

describe("the shared scoring kernel is a kernel", () => {
  /**
   * `src/lib/scoring/` holds what the stages must share so they cannot drift
   * apart, so the dependency runs stage -> kernel and never back. It ran back
   * once: `transcript-evidence.ts` imported the quote matcher from
   * `resume-scoring/validate.ts`, which made the resume stage's helper
   * load-bearing for how a screening and an interview verify their quotes. A
   * change made for resume reasons would have silently changed both spoken
   * stages — exactly the drift this package exists to prevent.
   */
  it("imports no stage package", () => {
    expect(
      offenders("scoring", /^@\/lib\/(resume-scoring|screening-scoring|interview-scoring)\b/),
    ).toEqual([]);
  });
});

describe('every export of a "use server" module is a public endpoint', () => {
  const actionFiles = sourceFiles(join(LIB, "actions")).filter((file) =>
    /^\s*"use server"/m.test(readFileSync(file, "utf8")),
  );

  it("finds the action modules to check", () => {
    expect(actionFiles.length).toBeGreaterThan(5);
  });

  /**
   * Next.js turns EVERY export of a `"use server"` module into a callable
   * endpoint, whether or not a client component imports it. So an exported
   * action that accepts the acting user's id as an argument authenticates
   * nobody: the ownership checks inside are all scoped by the id they are
   * handed, and naming somebody else's satisfies every one of them.
   *
   * `scoreUnscoredCampaignCandidates` shipped that way. It spends OpenAI
   * budget, transitions applications and emails candidates, and took the
   * campaign owner as a parameter. The identity must come from
   * `requireUserId()` inside the action; a helper that genuinely needs to be
   * passed one belongs in a module that is not `"use server"`, which is what
   * `actions/interview-scoring.ts` documents and does.
   */
  it.each(actionFiles.map(rel))("%s takes no caller-supplied user id", (relative) => {
    const src = readFileSync(join(process.cwd(), relative), "utf8");
    // No `s` flag: `[^)]` already spans the newlines in a multi-line parameter
    // list, and the flag needs an es2018 target this project does not set.
    const taking = [...src.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
      .filter(([, , params]) => /\buser_?[Ii]d\b/.test(params))
      .map(([, name]) => name);

    expect(taking).toEqual([]);
  });
});
