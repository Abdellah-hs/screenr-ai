"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { uploadResume } from "@/lib/actions/resume";
import { createCandidate } from "@/lib/actions/candidates";

const inputClass =
  "w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors";

interface AddCandidateFormProps {
  campaignId: string;
}

export default function AddCandidateForm({ campaignId }: AddCandidateFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [parsingResume, setParsingResume] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [resumeData, setResumeData] = useState<{
    skills: string[];
    experience_years: number;
    education: string;
  } | null>(null);

  // Form field state (for AI auto-fill)
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [currentCompany, setCurrentCompany] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setUploadingResume(true);

    try {
      const formData = new FormData();
      formData.append("resume", file);
      const result = await uploadResume(formData);
      setResumeUrl(result.resume_url);
      setResumeText(result.resume_text);
      setUploadingResume(false);

      // AI parsing step
      if (result.resume_text) {
        setParsingResume(true);
        try {
          const { parseResumeWithAI } = await import("@/lib/actions/ai-resume");
          const parsed = await parseResumeWithAI(result.resume_text);
          // Auto-fill form fields
          if (parsed.name && !name) setName(parsed.name);
          if (parsed.email && !email) setEmail(parsed.email);
          if (parsed.phone && !phone) setPhone(parsed.phone);
          if (parsed.current_title && !currentTitle) setCurrentTitle(parsed.current_title);
          if (parsed.current_company && !currentCompany) setCurrentCompany(parsed.current_company);
          setResumeData({
            skills: parsed.skills,
            experience_years: parsed.experience_years,
            education: parsed.education,
          });
        } catch (parseErr) {
          // Parsing is optional — don't block the form
          console.error("AI parsing failed:", parseErr);
        } finally {
          setParsingResume(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadingResume(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("email", email);
      formData.append("phone", phone);
      formData.append("current_title", currentTitle);
      formData.append("current_company", currentCompany);
      if (resumeUrl) formData.append("resume_url", resumeUrl);
      if (resumeText) formData.append("resume_text", resumeText);
      if (resumeData) formData.append("resume_json", JSON.stringify(resumeData));

      const result = await createCandidate(campaignId, formData);
      router.push(`/campaigns/${campaignId}/candidates/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create candidate");
      setLoading(false);
    }
  }

  const isUploading = uploadingResume || parsingResume;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 bg-white p-6 rounded-xl border border-[#E5E7EB]">
      {error && (
        <div className="p-3 text-sm text-[#DC2626] bg-[#FEF2F2] rounded-lg border border-[#FECACA]">
          {error}
        </div>
      )}

      {/* Resume Upload */}
      <div>
        <label className="block text-sm font-medium text-[#111827] mb-1">
          Resume (PDF)
        </label>
        <div
          className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            fileName
              ? "border-[#2563EB] bg-[#EFF6FF]"
              : "border-[#D1D5DB] hover:border-[#9CA3AF]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={isUploading}
          />
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <svg className="animate-spin h-6 w-6 text-[#2563EB]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm text-[#2563EB] font-medium">
                {uploadingResume ? "Uploading..." : "AI is parsing resume..."}
              </span>
            </div>
          ) : fileName ? (
            <div className="flex items-center justify-center gap-2">
              <svg className="h-5 w-5 text-[#2563EB]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-[#111827] font-medium">{fileName}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFileName(null);
                  setResumeUrl(null);
                  setResumeText(null);
                  setResumeData(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="ml-2 text-xs text-[#6B7280] hover:text-[#DC2626] cursor-pointer transition-colors"
              >
                Remove
              </button>
            </div>
          ) : (
            <div>
              <svg className="mx-auto h-8 w-8 text-[#9CA3AF] mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm text-[#6B7280]">
                <span className="text-[#2563EB] font-medium cursor-pointer">Click to upload</span>{" "}
                or drag and drop
              </p>
              <p className="text-xs text-[#9CA3AF] mt-1">PDF or DOCX, up to 10MB</p>
            </div>
          )}
        </div>
        {resumeData && (
          <div className="mt-2 p-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
            <p className="text-xs font-medium text-[#166534] mb-1">AI extracted from resume:</p>
            <p className="text-xs text-[#166534]">
              {resumeData.skills.length} skills found | {resumeData.experience_years} years experience | {resumeData.education}
            </p>
          </div>
        )}
      </div>

      {/* Candidate Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-[#111827] mb-1">
            Full Name <span className="text-[#DC2626]">*</span>
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Jane Smith"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-[#111827] mb-1">
            Email <span className="text-[#DC2626]">*</span>
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="e.g. jane@example.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-[#111827] mb-1">
          Phone
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
          placeholder="e.g. +1 555-123-4567"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="current_title" className="block text-sm font-medium text-[#111827] mb-1">
            Current Title
          </label>
          <input
            id="current_title"
            type="text"
            value={currentTitle}
            onChange={(e) => setCurrentTitle(e.target.value)}
            className={inputClass}
            placeholder="e.g. Software Engineer"
          />
        </div>
        <div>
          <label htmlFor="current_company" className="block text-sm font-medium text-[#111827] mb-1">
            Current Company
          </label>
          <input
            id="current_company"
            type="text"
            value={currentCompany}
            onChange={(e) => setCurrentCompany(e.target.value)}
            className={inputClass}
            placeholder="e.g. Acme Corp"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-[#E5E7EB]">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || isUploading}
          className="px-4 py-2 text-sm font-medium text-white bg-[#2563EB] rounded-lg cursor-pointer hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Adding..." : "Add Candidate"}
        </button>
      </div>
    </form>
  );
}
