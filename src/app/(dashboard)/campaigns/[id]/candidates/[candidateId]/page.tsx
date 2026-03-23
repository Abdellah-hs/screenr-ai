import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidateById } from "@/lib/actions/candidates";
import StageTransitionButtons from "@/components/campaigns/stage-transition-buttons";
import ScreenCandidateButton from "@/components/campaigns/screen-candidate-button";
import type { CandidateStage, CandidateScore } from "@/lib/constants";

const stageColors: Record<CandidateStage, string> = {
  applied: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  screening: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
  interview: "text-[#7C3AED] bg-[#F5F3FF] border-[#DDD6FE]",
  offer: "text-[#D97706] bg-[#FEF3C7] border-[#FDE68A]",
  hired: "text-[#059669] bg-[#ECFDF5] border-[#A7F3D0]",
  rejected: "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]",
};

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
        <h3 className="text-sm font-semibold text-[#111827]">
          {scoreStageLabels[score.stage] ?? score.stage}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-[#111827]">
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

      {/* AI Summary */}
      <div className="bg-[#F9FAFB] rounded-lg p-3 mb-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <svg
            className="w-3.5 h-3.5 text-[#2563EB]"
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
          <span className="text-xs font-medium text-[#2563EB]">
            AI Summary
          </span>
        </div>
        <p className="text-sm text-[#4B5563] leading-relaxed">
          {score.ai_summary}
        </p>
      </div>

      {/* Score Factors */}
      <div className="space-y-2.5">
        {score.factors.map((factor) => (
          <div key={factor.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[#6B7280]">{factor.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#9CA3AF]">
                  {Math.round(factor.weight * 100)}%
                </span>
                <span className="text-xs font-semibold text-[#111827]">
                  {factor.score}
                </span>
              </div>
            </div>
            <div className="w-full h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  factor.score >= 80
                    ? "bg-[#059669]"
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
          className="hover:text-[#111827] transition-colors"
        >
          Campaigns
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${id}`}
          className="hover:text-[#111827] transition-colors"
        >
          {campaign.title}
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${id}/candidates`}
          className="hover:text-[#111827] transition-colors"
        >
          Candidates
        </Link>
        <span>/</span>
        <span className="text-[#111827]">{candidate.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#EFF6FF] flex items-center justify-center text-lg font-semibold text-[#2563EB]">
              {candidate.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-[#111827]">
                  {candidate.name}
                </h1>
                <span
                  className={`inline-flex px-2.5 py-0.5 text-xs font-medium border rounded-md capitalize ${stageColors[candidate.stage]}`}
                >
                  {candidate.stage}
                </span>
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
        <Link
          href={`/campaigns/${id}/candidates`}
          className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] transition-all duration-200"
        >
          Back to List
        </Link>
      </div>

      {/* Stage Transitions + AI Screening */}
      <div className="flex items-start gap-4 mb-6">
        <StageTransitionButtons candidateId={candidate.id} currentStage={candidate.stage} />
        <ScreenCandidateButton
          candidateId={candidate.id}
          hasResumeText={!!candidate.resume_text}
          hasResumeScore={candidate.scores.some((s) => s.stage === "resume")}
          currentStage={candidate.stage}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Info + Resume */}
        <div className="lg:col-span-1 space-y-6">
          {/* Contact */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
            <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
              Contact
            </h2>
            <div className="space-y-3">
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
                    d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                  />
                </svg>
                <span className="text-sm text-[#4B5563] truncate">
                  {candidate.email}
                </span>
              </div>
              {candidate.phone && (
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
                      d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                    />
                  </svg>
                  <span className="text-sm text-[#4B5563]">
                    {candidate.phone}
                  </span>
                </div>
              )}
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
            <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
              Resume
            </h2>
            {candidate.resume_url && (
              <div className="mb-4 p-3 bg-[#F9FAFB] rounded-lg flex items-center gap-2">
                <svg className="w-4 h-4 text-[#6B7280] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <span className="text-xs text-[#6B7280]">Resume uploaded</span>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <p className="text-xs text-[#6B7280] mb-1">Education</p>
                <p className="text-sm text-[#111827]">
                  {candidate.resume.education}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6B7280] mb-1">Experience</p>
                <p className="text-sm text-[#111827]">
                  {candidate.resume.experience_years} year
                  {candidate.resume.experience_years !== 1 ? "s" : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6B7280] mb-2">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.resume.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-[#F3F4F6] text-[#4B5563]"
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
          <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
            Evaluation Scores
          </h2>
          {candidate.scores.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 text-center">
              <div className="w-12 h-12 bg-[#F3F4F6] text-[#9CA3AF] rounded-full flex items-center justify-center mx-auto mb-3">
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
            candidate.scores.map((score, i) => (
              <ScoreCard key={i} score={score} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
