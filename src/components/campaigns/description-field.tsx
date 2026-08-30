"use client";

import { useRef, useState } from "react";
import { generateCampaignDescription } from "@/lib/actions/ai-generate";
import type { GenerateDescriptionInput } from "@/lib/validations";
import { cn } from "@/lib/utils";

const SENIORITY_OPTIONS = ["Intern", "Junior", "Mid", "Senior", "Lead", "Principal", "Manager", "Director"];
const EMPLOYMENT_OPTIONS = ["Full-time", "Part-time", "Contract", "Internship", "Temporary"];

const inputClass =
  "w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors";

type Mode = GenerateDescriptionInput["mode"];

/**
 * The campaign description field with an AI drafting assist. The assist is
 * advisory: it drops a draft into a preview the recruiter chooses to Replace /
 * Insert / Regenerate / Discard — nothing is saved until the form is submitted.
 * Grounding inputs (seniority, skills, …) are generation-only; title/department/
 * location are read live from the surrounding form.
 */
export function DescriptionField({
  initialValue = "",
  value: controlledValue,
  onChange,
  rows = 4,
}: {
  /** Uncontrolled seed. Ignored when `value` is passed. */
  initialValue?: string;
  /** Controlled mode — required by the wizard, whose steps unmount. */
  value?: string;
  /** Reports the current text — the AI-assist buttons write to it too, so a
   *  caller cannot get this from the textarea's own change events. */
  onChange?: (value: string) => void;
  rows?: number;
}) {
  const [internal, setInternal] = useState(initialValue);
  const value = controlledValue ?? internal;

  function setValue(next: string | ((current: string) => string)) {
    const resolved = typeof next === "function" ? next(value) : next;
    if (controlledValue === undefined) setInternal(resolved);
    onChange?.(resolved);
  }

  const [panelOpen, setPanelOpen] = useState(false);

  const [seniority, setSeniority] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [skills, setSkills] = useState("");
  const [companyContext, setCompanyContext] = useState("");

  const [loading, setLoading] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const lastModeRef = useRef<Mode>("generate");

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Read a sibling form field by name (title/department/location). */
  function fieldValue(name: string): string {
    const el = textareaRef.current?.form?.elements.namedItem(name);
    if (el && "value" in el) {
      const value = (el as { value: unknown }).value;
      if (typeof value === "string") return value.trim();
    }
    return "";
  }

  async function run(mode: Mode) {
    setError(null);

    const title = fieldValue("title");
    if (!title) {
      setError("Add a role title first — the draft is built from it.");
      return;
    }
    if (mode === "improve" && value.trim().length === 0) {
      setError("There's no draft to improve yet. Write something or use Generate.");
      return;
    }

    lastModeRef.current = mode;
    setLoading(mode);
    try {
      const skillList = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const { text } = await generateCampaignDescription({
        mode,
        title,
        department: fieldValue("department") || undefined,
        location: fieldValue("location") || undefined,
        seniority: seniority || undefined,
        employmentType: employmentType || undefined,
        skills: skillList.length > 0 ? skillList : undefined,
        companyContext: companyContext.trim() || undefined,
        currentDraft: mode === "improve" ? value : undefined,
      });
      setPreview(text);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't generate a description. Try again.",
      );
    } finally {
      setLoading(null);
    }
  }

  function acceptReplace() {
    if (preview === null) return;
    setValue(preview);
    setPreview(null);
    setPanelOpen(false);
  }

  function acceptInsert() {
    if (preview === null) return;
    setValue((v) => (v.trim() ? `${v.trim()}\n\n${preview}` : preview));
    setPreview(null);
  }

  const busy = loading !== null;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor="description" className="block text-sm font-medium text-[#111827]">
          Description <span className="text-[#DC2626]">*</span>
        </label>
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
            panelOpen
              ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]"
              : "border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-[#F9FAFB] hover:text-[#111827]",
          )}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-6.714 2.143L12 21l-2.286-6.857L3 12l6.714-2.143L12 3z" />
          </svg>
          AI assist
        </button>
      </div>

      <textarea
        ref={textareaRef}
        id="description"
        name="description"
        required
        rows={panelOpen ? rows + 3 : rows}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full resize-y rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm text-[#111827] outline-none transition-colors focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
        placeholder="Describe the role and requirements…"
      />

      {panelOpen && (
        <div className="mt-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              aria-label="Seniority"
              className={cn(inputClass, "cursor-pointer")}
            >
              <option value="">Seniority (optional)</option>
              {SENIORITY_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              aria-label="Employment type"
              className={cn(inputClass, "cursor-pointer")}
            >
              <option value="">Employment type (optional)</option>
              {EMPLOYMENT_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            aria-label="Key skills"
            placeholder="Key skills (comma-separated, optional)"
            className={cn(inputClass, "mt-2")}
          />

          <textarea
            value={companyContext}
            onChange={(e) => setCompanyContext(e.target.value)}
            aria-label="Company context"
            rows={2}
            placeholder="Company context (optional) — team, product, what makes the role matter"
            className={cn(inputClass, "mt-2 resize-y")}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run("generate")}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
                busy ? "cursor-default bg-[#93C5FD]" : "cursor-pointer bg-[#2563EB] hover:bg-[#1D4ED8]",
              )}
            >
              {loading === "generate" ? "Generating…" : "Generate draft"}
            </button>
            <button
              type="button"
              onClick={() => run("improve")}
              disabled={busy || value.trim().length === 0}
              title={value.trim().length === 0 ? "Write a draft first" : "Refine the current draft"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
                busy || value.trim().length === 0
                  ? "cursor-not-allowed border-[#E5E7EB] bg-white text-[#9CA3AF]"
                  : "cursor-pointer border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827]",
              )}
            >
              {loading === "improve" ? "Improving…" : "Improve current draft"}
            </button>
          </div>

          {error && <p className="mt-2 text-xs text-[#DC2626]">{error}</p>}

          {preview !== null && (
            <div className="mt-3 rounded-lg border border-[#BFDBFE] bg-white p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#2563EB]">
                AI draft — review before using
              </p>
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-[#374151]">
                {preview}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={acceptReplace}
                  className="cursor-pointer rounded-md bg-[#2563EB] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={acceptInsert}
                  className="cursor-pointer rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F3F4F6] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  Insert below
                </button>
                <button
                  type="button"
                  onClick={() => run(lastModeRef.current)}
                  disabled={busy}
                  className="cursor-pointer rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F3F4F6] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default disabled:text-[#9CA3AF]"
                >
                  {busy ? "Working…" : "Regenerate"}
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium text-[#6B7280] transition-colors hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
