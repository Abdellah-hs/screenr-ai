import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidateById } from "@/lib/actions/candidates";
import { ScoreResumeButton } from "@/components/candidates/score-resume-button";
import { StageChanger } from "@/components/candidates/stage-changer";
import type { CandidateStage, CandidateScore } from "@/lib/constants";

const tierColors: Record<string, string> = {
  strong: "text-[#059669] bg-[#ECFDF5]",
  moderate: "text-[#D97706] bg-[#FEF3C7]",
  weak: "text-[#DC2626] bg-[#FEF2F2]",
};

const scoreStageLabels: Record<string, string> = {
  resume: "Resume Review",
  screening: "Screening Call",
  interview: "Interview",
};

function ScoreCard({ score }: { score: CandidateScore }) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#0C4A6E]">
          {scoreStageLabels[score.stage] ?? score.stage}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-[#0C4A6E]">
            {score.overall}
          </span>
          {score.tier && (
            <span
              className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full capitalize ${tierColors[score.tier]}`}
            >
              {score.tier}
            </span>
          )}
        </div>
      </div>

      <div className="bg-[#F0F9FF] rounded-lg p-3 mb-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <svg
            className="w-3.5 h-3.5 text-[#0369A1]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
            />
          </svg>
          <span className="text-xs font-medium text-[#0369A1]">
            AI Summary
          </span>
        </div>
        <p className="text-sm text-[#4B5563] leading-relaxed">
          {score.ai_summary}
        </p>
      </div>

      <div className="space-y-2.5">
        {score.factors.map((factor) => (
          <div key={factor.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[#6B7280]">{factor.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#9CA3AF]">
                  {Math.round(factor.weight * 100)}%
                </span>
                <span className="text-xs font-semibold text-[#0C4A6E]">
                  {factor.score}
                </span>
              </div>
            </div>
            <div className="w-full h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  factor.score >= 80
                    ? "bg-[#22C55E]"
                    : factor.score >= 60
                      ? "bg-[#D97706]"
                      : "bg-[#DC2626]"
                }`}
                style={{ width: `${factor.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#9CA3AF] mt-3">
        Scored{" "}
        {new Date(score.scored_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string; candidateId: string }>;
}) {
  const { id, candidateId } = await params;
  const [campaign, candidate] = await Promise.all([
    getCampaignById(id),
    getCandidateById(candidateId),
  ]);

  if (!campaign || !candidate) {
    notFound();
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6B7280] mb-4">
        <Link
          href="/campaigns"
          className="hover:text-[#0369A1] transition-all duration-200"
        >
          Campaigns
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${id}`}
          className="hover:text-[#0369A1] transition-all duration-200"
        >
          {campaign.title}
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${id}/candidates`}
          className="hover:text-[#0369A1] transition-all duration-200"
        >
          Candidates
        </Link>
        <span>/</span>
        <span className="text-[#0C4A6E]">{candidate.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#F0F9FF] flex items-center justify-center text-lg font-semibold text-[#0369A1]">
              {candidate.name
                .split(" ")
                .map((n: string) => n[0])
                .join("")}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-[#0C4A6E]">
                  {candidate.name}
                </h1>
                <StageChanger
                  applicationId={candidateId}
                  currentStage={candidate.stage as CandidateStage}
                />
              </div>
              {candidate.current_title && (
                <p className="text-sm text-[#6B7280] mt-0.5">
                  {candidate.current_title}
                  {candidate.current_company &&
                    ` at ${candidate.current_company}`}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {candidate.scores.length === 0 && (
            <ScoreResumeButton applicationId={candidateId} />
          )}
          <Link
            href={`/campaigns/${id}/candidates`}
            className="px-4 py-2 text-sm font-medium text-[#4B5563] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#0C4A6E] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1]"
          >
            Back to List
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Info + Resume */}
        <div className="lg:col-span-1 space-y-6">
          {/* Contact */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
            <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider mb-4">
              Contact
            </h2>
            <div className="space-y-3">
              {/* Email — clickable mailto */}
              <a
                href={`mailto:${candidate.email}`}
                className="flex items-center gap-2.5 group cursor-pointer"
              >
                <svg
                  className="w-4 h-4 text-[#9CA3AF] shrink-0 group-hover:text-[#0369A1] transition-all duration-200"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                  />
                </svg>
                <span className="text-sm text-[#4B5563] truncate group-hover:text-[#0369A1] transition-all duration-200">
                  {candidate.email}
                </span>
              </a>

              {/* Phone — clickable tel */}
              {candidate.phone && (
                <a
                  href={`tel:${candidate.phone}`}
                  className="flex items-center gap-2.5 group cursor-pointer"
                >
                  <svg
                    className="w-4 h-4 text-[#9CA3AF] shrink-0 group-hover:text-[#0369A1] transition-all duration-200"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                    />
                  </svg>
                  <span className="text-sm text-[#4B5563] group-hover:text-[#0369A1] transition-all duration-200">
                    {candidate.phone}
                  </span>
                </a>
              )}

              {/* LinkedIn — clickable external link */}
              {candidate.linkedin_url && (
                <a
                  href={candidate.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 group cursor-pointer"
                >
                  <svg
                    className="w-4 h-4 text-[#9CA3AF] shrink-0 group-hover:text-[#0369A1] transition-all duration-200"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                  <span className="text-sm text-[#4B5563] group-hover:text-[#0369A1] transition-all duration-200">
                    LinkedIn Profile
                  </span>
                  <svg
                    className="w-3 h-3 text-[#9CA3AF] shrink-0 group-hover:text-[#0369A1] transition-all duration-200"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
              )}

              {/* Portfolio — clickable external link */}
              {candidate.portfolio_url && (
                <a
                  href={candidate.portfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 group cursor-pointer"
                >
                  <svg
                    className="w-4 h-4 text-[#9CA3AF] shrink-0 group-hover:text-[#0369A1] transition-all duration-200"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                    />
                  </svg>
                  <span className="text-sm text-[#4B5563] truncate group-hover:text-[#0369A1] transition-all duration-200">
                    Portfolio
                  </span>
                  <svg
                    className="w-3 h-3 text-[#9CA3AF] shrink-0 group-hover:text-[#0369A1] transition-all duration-200"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
              )}

              {/* Applied date */}
              <div className="flex items-center gap-2.5">
                <svg
                  className="w-4 h-4 text-[#9CA3AF] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                  />
                </svg>
                <span className="text-sm text-[#4B5563]">
                  Applied{" "}
                  {new Date(candidate.applied_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Resume */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider">
                Resume
              </h2>
              {candidate.resume_url && (
                <a
                  href={candidate.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0369A1] bg-[#F0F9FF] rounded-lg cursor-pointer hover:bg-[#E0F2FE] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1]"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  View PDF
                </a>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-[#6B7280] mb-1">Education</p>
                <p className="text-sm text-[#0C4A6E]">
                  {candidate.resume.education}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6B7280] mb-1">Experience</p>
                <p className="text-sm text-[#0C4A6E]">
                  {candidate.resume.experience_years} year
                  {candidate.resume.experience_years !== 1 ? "s" : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6B7280] mb-2">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.resume.skills.map((skill: string) => (
                    <span
                      key={skill}
                      className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-[#F0F9FF] text-[#0369A1]"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column — Scores */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider">
            Evaluation Scores
          </h2>
          {candidate.scores.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 text-center">
              <div className="w-12 h-12 bg-[#F0F9FF] text-[#0EA5E9] rounded-full flex items-center justify-center mx-auto mb-3">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <p className="text-sm text-[#6B7280]">
                No scores yet. This candidate hasn&apos;t been evaluated.
              </p>
            </div>
          ) : (
            candidate.scores.map((score: CandidateScore, i: number) => (
              <ScoreCard key={i} score={score} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
