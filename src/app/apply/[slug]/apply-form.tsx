"use client";

import { useRef, useState, useTransition } from "react";
import { submitApplication } from "@/lib/actions/apply";
import MatiousLogo from "@/components/matious-logo";

// Mirror of the server's accepted types — for instant client-side feedback only;
// the server (`isSupportedResumeMimeType`) remains authoritative.
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ACCEPT_ATTR = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 10 * 1024 * 1024;

// Loose shape check for instant feedback; the server's Zod schema is authoritative.
const EMAIL_RE = /^\S+@\S+\.\S+$/;

const INPUT_CLASS =
  "w-full rounded-lg border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-[#0369A1] transition-colors duration-200 disabled:opacity-50";

interface ApplyFormProps {
  slug: string;
  campaignTitle: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BrandBar() {
  return (
    <header className="bg-white border-b border-[#E5E7EB]">
      <div className="max-w-xl mx-auto px-4 py-4 sm:px-6">
        <MatiousLogo className="text-xl" />
      </div>
    </header>
  );
}

export default function ApplyForm({ slug, campaignTitle }: ApplyFormProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
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

  function validate(): string | null {
    if (!firstName.trim()) return "Please enter your first name.";
    if (!lastName.trim()) return "Please enter your last name.";
    if (!EMAIL_RE.test(email.trim())) return "Please enter a valid email address.";
    if (!file) return "Please attach your CV before submitting.";
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

    const data = new FormData();
    data.set("slug", slug);
    data.set("first_name", firstName);
    data.set("last_name", lastName);
    data.set("email", email);
    data.set("resume", file as File);

    startSubmit(async () => {
      try {
        await submitApplication(data);
        setSubmitted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
        <BrandBar />
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-md w-full bg-white rounded-2xl border border-[#E5E7EB] p-6 sm:p-8 shadow-sm text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4 mx-auto">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-[#111827] mb-2">Application received</h1>
            <p className="text-sm text-[#6B7280]">
              Thanks for applying to <strong>{campaignTitle}</strong>. A confirmation email is on
              its way to <strong>{email.trim()}</strong>, and the hiring team will be in touch if
              there&apos;s a fit.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
      <BrandBar />
      <main className="flex-1 py-8 sm:py-12 px-4">
        <div className="max-w-xl mx-auto">
          <header className="mb-6 sm:mb-8">
            <p className="text-xs font-medium uppercase tracking-wider text-[#0369A1] mb-2">
              Careers at Matious
            </p>
            <h1 className="text-xl sm:text-2xl font-semibold text-[#111827] mb-2">{campaignTitle}</h1>
            <p className="text-sm text-[#6B7280]">
              Tell us who you are and attach your CV. We&apos;ll email you a confirmation as soon
              as your application is in.
            </p>
          </header>

          {error && (
            <div role="alert" className="mb-6 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            noValidate
            className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-5 sm:p-8 space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="apply-first-name" className="block text-sm font-medium text-[#111827] mb-1.5">
                  First name
                </label>
                <input
                  id="apply-first-name"
                  name="first_name"
                  type="text"
                  autoComplete="given-name"
                  placeholder="Alex"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={submitting}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="apply-last-name" className="block text-sm font-medium text-[#111827] mb-1.5">
                  Last name
                </label>
                <input
                  id="apply-last-name"
                  name="last_name"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Morgan"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={submitting}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div>
              <label htmlFor="apply-email" className="block text-sm font-medium text-[#111827] mb-1.5">
                Email address
              </label>
              <input
                id="apply-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className={INPUT_CLASS}
              />
              <p className="mt-1.5 text-xs text-[#9CA3AF]">
                We&apos;ll send your application confirmation here.
              </p>
            </div>

            <div>
              <span className="block text-sm font-medium text-[#111827] mb-1.5">CV / Resume</span>
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
        </div>
      </main>
    </div>
  );
}
