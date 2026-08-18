import { describe, expect, it } from "vitest";
import { toAuditCsv, toAuditJson } from "./export";
import type { AuditLogEntry } from "@/lib/data/audit-log";

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "aud-1",
    created_at: "2026-08-18T10:00:00.000Z",
    stage: "resume_scoring",
    model: "gpt-4o-mini",
    prompt_version: "v1",
    rubric_version: "3",
    parsed_score: 82,
    confidence: 0.9,
    rationale: "Strong systems depth.",
    raw_output: '{"score":82}',
    input_snapshot: { resume_length: 1200 },
    action_taken: null,
    campaign_id: "camp-1",
    campaign_title: "Backend Engineer",
    candidate_id: "cand-1",
    candidate_name: "Ada Lovelace",
    recruiter_action_after: null,
    ...overrides,
  };
}

describe("toAuditCsv", () => {
  it("writes a header row followed by one row per entry", () => {
    const csv = toAuditCsv([entry(), entry({ id: "aud-2" })]);

    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("id,created_at");
  });

  /**
   * `raw_output` is unmodified model output. If a quote or newline in it isn't
   * escaped, every column after it shifts — and the export is what an auditor
   * reads instead of the database, so a silently malformed row is worse than a
   * missing one.
   */
  it("escapes embedded quotes so following columns don't shift", () => {
    const csv = toAuditCsv([entry({ raw_output: '{"verdict":"strong"}' })]);

    // Each " doubled, whole cell wrapped.
    expect(csv).toContain('"{""verdict"":""strong""}"');
  });

  it("keeps a multi-line raw output inside a single quoted cell", () => {
    const csv = toAuditCsv([entry({ raw_output: "line one\nline two" })]);

    const [header, ...rest] = csv.split("\r\n");
    expect(header).toBeDefined();
    // The newline lives INSIDE the quoted field, so the record spans two
    // physical lines but is still exactly one CSV row.
    expect(rest.join("\r\n")).toContain('"line one\nline two"');
  });

  it("does not let a comma in a field create a phantom column", () => {
    const csv = toAuditCsv([entry({ rationale: "Strong, but shallow on testing" })]);

    expect(csv).toContain('"Strong, but shallow on testing"');
  });

  it("renders nulls as empty cells rather than the string 'null'", () => {
    const csv = toAuditCsv([entry({ rationale: null, parsed_score: null })]);

    expect(csv).not.toContain("null");
    expect(csv).toContain('""');
  });

  it("flattens the recruiter action onto the same row", () => {
    const csv = toAuditCsv([
      entry({
        recruiter_action_after: {
          from_state: "screening_scored",
          to_state: "rejected",
          rationale: "Not enough depth on distributed systems",
          disposition_code: "OVERRIDE_REJECTED",
          at: "2026-08-18T12:00:00.000Z",
        },
      }),
    ]);

    expect(csv).toContain("OVERRIDE_REJECTED");
    expect(csv).toContain("Not enough depth on distributed systems");
  });

  it("emits only a header for an empty selection", () => {
    const csv = toAuditCsv([]);

    expect(csv.split("\r\n")).toHaveLength(1);
  });
});

describe("toAuditJson", () => {
  it("round-trips the entries without losing the raw output", () => {
    const raw = '{"verdict":"strong","note":"quote \\" inside"}';

    const parsed = JSON.parse(toAuditJson([entry({ raw_output: raw })])) as AuditLogEntry[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].raw_output).toBe(raw);
  });

  it("preserves the input snapshot structure", () => {
    const parsed = JSON.parse(
      toAuditJson([entry({ input_snapshot: { nested: { turns: 12 } } })]),
    ) as AuditLogEntry[];

    expect(parsed[0].input_snapshot).toEqual({ nested: { turns: 12 } });
  });
});
