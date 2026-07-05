"use client";

import { useRef, useState, useTransition } from "react";
import { submitApplication } from "@/lib/actions/apply";
import MatiousLogo from "@/components/matious-logo";
import BrandPanel from "./brand-panel";

// Mirror of the server's accepted types — for instant client-side feedback only;
// the server (`isSupportedResumeMimeType`) remains authoritative.
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ACCEPT_ATTR = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 10 * 1024 * 1024;

const INPUT_CLASS =
  "w-full rounded-lg border border-[#D1D5DB] bg-white px-3.5 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-[#0369A1] transition-colors duration-200 disabled:opacity-50";

interface ApplyFormProps {
  slug: string;
  campaignTitle: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Required() {
  return (
    <span className="text-red-500" aria-hidden="true">
      *
    </span>
  );
}

export default function ApplyForm({ slug, campaignTitle }: ApplyFormProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function selectFile(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_MIME.has(next.type)) {
      setError("Please upload your CV as a PDF or Word (.docx) document.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setError("That file is too large. Please upload a CV under 10 MB.");
      return;
    }
    setFile(next);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    selectFile(e.dataTransfer.files?.[0] ?? null);
  }

  // Step 1 → 2. Native validation (required, type=email) has already passed.
  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep(2);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please attach your CV before submitting.");
      return;
    }
    setError(null);

    const data = new FormData();
    data.set("slug", slug);
    data.set("first_name", firstName);
    data.set("last_name", lastName);
    data.set("email", email);
    data.set("linkedin", linkedin);
    data.set("website", website);
    data.set("resume", file);

    startSubmit(async () => {
      try {
        await submitApplication(data);
        setSubmitted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      {/* Left column: logo, form, progress dots */}
      <div className="flex min-h-screen flex-col px-6 sm:px-10">
        <header className="py-6">
          <MatiousLogo className="text-xl" />
        </header>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            {submitted ? (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4 mx-auto">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="text-xl font-semibold text-[#111827] mb-2">Application received</h1>
                <p className="text-sm text-[#6B7280]">
                  Thanks for applying to <strong>{campaignTitle}</strong>. A confirmation email is
                  on its way to <strong>{email.trim()}</strong>, and the hiring team will be in
                  touch if there&apos;s a fit.
                </p>
              </div>
            ) : (
              <>
                {step === 1 ? (
                  <>
                    <h1 className="text-2xl font-semibold text-[#111827]">Apply for this role</h1>
                    <p className="mt-1.5 text-sm font-semibold text-[#0369A1]">{campaignTitle}</p>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep(1);
                      }}
                      disabled={submitting}
                      className="inline-flex items-center gap-1 text-sm font-medium text-[#6B7280] hover:text-[#111827] transition-colors cursor-pointer mb-4 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      Back
                    </button>
                    <h1 className="text-2xl font-semibold text-[#111827]">Almost done</h1>
                    <p className="mt-1.5 text-sm text-[#6B7280]">
                      Attach your CV to finish your application to{" "}
                      <span className="font-semibold text-[#0369A1]">{campaignTitle}</span>.
                    </p>
                  </>
                )}

                {error && (
                  <div role="alert" className="mt-5 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
                    {error}
                  </div>
                )}

                {step === 1 ? (
                  <form onSubmit={handleContinue} className="mt-7 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="apply-first-name" className="block text-sm font-medium text-[#111827] mb-1.5">
                          First name <Required />
                        </label>
                        <input
                          id="apply-first-name"
                          name="first_name"
                          type="text"
                          autoComplete="given-name"
                          required
                          placeholder="Enter your first name"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label htmlFor="apply-last-name" className="block text-sm font-medium text-[#111827] mb-1.5">
                          Last name <Required />
                        </label>
                        <input
                          id="apply-last-name"
                          name="last_name"
                          type="text"
                          autoComplete="family-name"
                          required
                          placeholder="Enter your last name"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="apply-email" className="block text-sm font-medium text-[#111827] mb-1.5">
                        Email <Required />
                      </label>
                      <input
                        id="apply-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        required
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={INPUT_CLASS}
                      />
                      <p className="mt-1.5 text-xs text-[#9CA3AF]">
                        We&apos;ll send your application confirmation here.
                      </p>
                    </div>

                    <div>
                      <label htmlFor="apply-linkedin" className="block text-sm font-medium text-[#111827] mb-1.5">
                        LinkedIn
                      </label>
                      <div className="flex rounded-lg border border-[#D1D5DB] bg-white focus-within:ring-2 focus-within:ring-[#0369A1] focus-within:border-[#0369A1] transition-colors duration-200">
                        <span className="flex items-center rounded-l-lg border-r border-[#D1D5DB] bg-[#F9FAFB] px-3 text-sm text-[#6B7280] select-none">
                          linkedin.com/
                        </span>
                        <input
                          id="apply-linkedin"
                          name="linkedin"
                          type="text"
                          placeholder="in/username"
                          value={linkedin}
                          onChange={(e) => setLinkedin(e.target.value)}
                          className="w-full rounded-r-lg px-3 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="apply-website" className="block text-sm font-medium text-[#111827] mb-1.5">
                        Personal site
                      </label>
                      <div className="flex rounded-lg border border-[#D1D5DB] bg-white focus-within:ring-2 focus-within:ring-[#0369A1] focus-within:border-[#0369A1] transition-colors duration-200">
                        <span className="flex items-center rounded-l-lg border-r border-[#D1D5DB] bg-[#F9FAFB] px-3 text-sm text-[#6B7280] select-none">
                          https://
                        </span>
                        <input
                          id="apply-website"
                          name="website"
                          type="text"
                          placeholder="www.example.com"
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                          className="w-full rounded-r-lg px-3 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full inline-flex items-center justify-center px-6 py-3 text-base font-semibold text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 min-h-[48px] !mt-6"
                    >
                      Continue
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                    <div>
                      <span className="block text-sm font-medium text-[#111827] mb-1.5">
                        CV / Resume <Required />
                      </span>
                      <input
                        ref={inputRef}
                        type="file"
                        accept={ACCEPT_ATTR}
                        className="sr-only"
                        onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
                      />

                      {!file ? (
                        <button
                          type="button"
                          onClick={() => inputRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragging(true);
                          }}
                          onDragLeave={() => setDragging(false)}
                          onDrop={handleDrop}
                          className={`w-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors duration-200 cursor-pointer ${
                            dragging
                              ? "border-[#0369A1] bg-[#F0F9FF]"
                              : "border-[#CBD5E1] bg-white hover:border-[#0369A1] hover:bg-[#F8FAFC]"
                          }`}
                        >
                          <span className="w-12 h-12 rounded-full bg-[#F0F9FF] flex items-center justify-center">
                            <svg className="w-6 h-6 text-[#0369A1]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                          </span>
                          <span className="text-sm font-medium text-[#111827]">
                            Drag your CV here, or <span className="text-[#0369A1]">browse</span>
                          </span>
                          <span className="text-xs text-[#9CA3AF]">PDF or Word (.docx), up to 10 MB</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                          <span className="w-10 h-10 shrink-0 rounded-lg bg-[#F0F9FF] flex items-center justify-center">
                            <svg className="w-5 h-5 text-[#0369A1]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[#111827]">{file.name}</p>
                            <p className="text-xs text-[#9CA3AF]">{formatSize(file.size)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              selectFile(null);
                              if (inputRef.current) inputRef.current.value = "";
                            }}
                            disabled={submitting}
                            aria-label="Remove file"
                            className="shrink-0 rounded-lg p-2 text-[#9CA3AF] hover:bg-[#F1F5F9] hover:text-[#6B7280] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
                    >
                      {submitting ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Submitting…
                        </>
                      ) : (
                        "Submit application"
                      )}
                    </button>

                    <p className="text-center text-xs text-[#9CA3AF]">
                      By submitting, you agree to let the hiring team review your details and CV for this role.
                    </p>
                  </form>
                )}
              </>
            )}
          </div>
        </div>

        {!submitted && (
          <div className="flex justify-center gap-2 pb-8" aria-hidden="true">
            {([1, 2] as const).map((s) => (
              <span
                key={s}
                className={`h-2 w-2 rounded-full transition-colors duration-200 ${
                  step === s ? "bg-[#0369A1]" : "bg-[#E5E7EB]"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      <BrandPanel />
    </div>
  );
}
