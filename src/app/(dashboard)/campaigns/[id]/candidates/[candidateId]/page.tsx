import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById, getResumeCriteriaCount } from "@/lib/actions/campaigns";
import { getCandidateById } from "@/lib/actions/candidates";
import { getCandidateScreeningState } from "@/lib/actions/screening-questions";
import { getInterviewBooking } from "@/lib/actions/schedule";
import { getInterviewSession } from "@/lib/actions/interview";
import { getCandidatePoolState } from "@/lib/actions/talent-pool";
import { getCandidateTimeline } from "@/lib/actions/timeline";
import { StageChanger } from "@/components/candidates/stage-changer";
import { HitlReviewPanel } from "@/components/candidates/hitl-review-panel";
import { ManagerReviewPanel } from "@/components/candidates/manager-review-panel";
import { TalentPoolButton } from "@/components/candidates/talent-pool-button";
import { ActivityTimelinePanel } from "@/components/candidates/activity-timeline";
import ScreeningThread from "@/components/candidates/screening-thread";
import InterviewTranscript from "@/components/candidates/interview-transcript";
import { RescoreResumeButton } from "@/components/candidates/rescore-resume-button";
import { RubricMismatchBadge } from "@/components/campaigns/rubric-mismatch-badge";
import {
  DecisionCard,
  StageScoresCard,
} from "@/components/candidates/decision-rail";
import { AiRail, AiCaption, AiEyebrow } from "@/components/ui";
import { formatApplicationState, TIER_LABELS } from "@/lib/constants";
import { uuidSchema } from "@/lib/validations";
import type { CandidateScore, ApplicationState } from "@/lib/constants";
import type { InterviewBooking } from "@/lib/data/scheduling";
import type { ParsedResumeData } from "@/lib/services/openai";

// Same four tones as the `tier*` Badge variants. Kept as a local map because
// the tier keys here are the score's own, not the badge's — but the hexes must
// not drift, or the same verdict reads two different ways on two screens.
const tierColors: Record<string, string> = {
  strong: "text-tier-strong bg-[#ECFDF5] border border-[#A7F3D0]",
  moderate: "text-tier-potential bg-[#FEF3C7] border border-[#FDE68A]",
  weak: "text-tier-weak bg-[#FEF2F2] border border-[#FECACA]",
  no_match: "text-tier-no-match bg-[#FEE2E2] border border-[#FCA5A5]",
};

const scoreStageLabels: Record<string, string> = {
  resume: "Resume Review",
  screening: "Screening Call",
  interview: "Interview",
};

function ProfileLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
    >
      {label}
      <svg
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
        />
      </svg>
    </a>
  );
}

function ScoreCard({
  score,
  applicationId,
  campaignActive,
}: {
  score: CandidateScore;
  applicationId: string;
  campaignActive: boolean;
}) {
  // Same visibility rule as the mismatch badge: both versions known and
  // different. The re-score button is the badge's call to action, so they
  // appear and disappear together (resume only — screening/interview scores
  // are produced from the candidate's response, not re-runnable on demand).
  const rubricIsStale =
    score.rubric_version != null &&
    score.current_rubric_version != null &&
    score.rubric_version !== score.current_rubric_version;

  const scoredAt = new Date(score.scored_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // The rail wraps the WHOLE block, not just the summary paragraph. The number,
  // the tier, the factor bars and the rationale are one object: you should not
  // be able to read a 61 without seeing that a model wrote it.
  return (
    <AiRail>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-[#111827]">
              {scoreStageLabels[score.stage] ?? score.stage}
            </h3>
            <RubricMismatchBadge
              scoredAt={score.rubric_version}
              currentVersion={score.current_rubric_version}
            />
            {score.stage === "resume" && rubricIsStale && (
              <RescoreResumeButton
                applicationId={applicationId}
                campaignActive={campaignActive}
              />
            )}
          </div>
          <div className="flex items-baseline gap-2 shrink-0">
            {/* `/100` is not decoration: a bare "61" invites comparison with
                the other stages, and there is no composite score to compare. */}
            <span className="text-2xl font-bold text-[#111827] tabular-nums">
              {score.overall}
              <span className="text-sm font-medium text-[#9CA3AF]">/100</span>
            </span>
            {score.tier && (
              <span
                className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${tierColors[score.tier]}`}
              >
                {TIER_LABELS[score.tier]}
              </span>
            )}
          </div>
        </div>

        <div className="mb-4">
          <AiEyebrow className="mb-1.5">
            {/* Heroicons: cpu-chip. Deliberately NOT a sparkle — this is a
                machine reading a document, not magic happening. */}
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
              />
            </svg>
            Assessment
          </AiEyebrow>
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
                  <span className="text-xs text-[#9CA3AF] tabular-nums">
                    {Math.round(factor.weight * 100)}%
                  </span>
                  <span className="text-xs font-semibold text-[#111827] tabular-nums">
                    {factor.score}
                  </span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    factor.score >= 80
                      ? "bg-tier-strong"
                      : factor.score >= 60
                        ? "bg-tier-potential"
                        : "bg-tier-weak"
                  }`}
                  style={{ width: `${factor.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <AiCaption
        className="px-5 py-3"
        rubricVersion={score.rubric_version}
        at={scoredAt}
        fallibility
      />
    </AiRail>
  );
}

function ChipGroup({ label, items }: { label: string; items: string[] }) {
  // Dedupe case-insensitively (the AI sometimes repeats a skill/tool), keeping
  // the first-seen spelling. Empty groups render nothing.
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return null;

  return (
    <div>
      <p className="text-xs text-[#6B7280] mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {unique.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-[#F3F4F6] text-[#374151]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ExperienceEntry({ exp }: { exp: ParsedResumeData["experience"][number] }) {
  const heading = [exp.title, exp.company].filter(Boolean).join(" · ");
  return (
    <div className="border-l-2 border-[#E5E7EB] pl-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-[#111827] min-w-0 break-words">{heading || "Role"}</p>
        {exp.duration && (
          <span className="text-xs text-[#9CA3AF] shrink-0 whitespace-nowrap">
            {exp.duration}
          </span>
        )}
      </div>
      {exp.description && (
        <p className="text-sm text-[#4B5563] mt-1 leading-relaxed">{exp.description}</p>
      )}
    </div>
  );
}

function EducationEntry({ edu }: { edu: ParsedResumeData["education"][number] }) {
  const years = [edu.year_start, edu.year_end].filter(Boolean).join(" – ");
  return (
    <div className="border-l-2 border-[#E5E7EB] pl-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-[#111827] min-w-0 break-words">
          {edu.institution || "Institution"}
        </p>
        {years && (
          <span className="text-xs text-[#9CA3AF] shrink-0 whitespace-nowrap">{years}</span>
        )}
      </div>
      {edu.degree && <p className="text-sm text-[#4B5563] mt-0.5">{edu.degree}</p>}
    </div>
  );
}

/**
 * Surfaces whether the candidate has actually booked their interview slot.
 * Covers the mainline `final_interview_scheduling` state (booking the final
 * human interview) plus the deprecated AI-interview pair
 * (`interview_scheduling` / `interview_scheduled`) still carried by in-flight
 * applications. Renders nothing outside those states.
 */
function InterviewBookingBanner({
  status,
  booking,
}: {
  status: ApplicationState;
  booking: InterviewBooking | null;
}) {
  if (
    status !== "final_interview_scheduling" &&
    status !== "interview_scheduling" &&
    status !== "interview_scheduled"
  ) {
    return null;
  }

  const isFinal = status === "final_interview_scheduling";

  // Booked — the candidate picked a slot. Green, with the confirmed time.
  if (booking && booking.status === "booked") {
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: booking.timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(booking.scheduled_at));

    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-4"
      >
        <svg className="w-5 h-5 text-[#059669] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-[#065F46]">
            {isFinal ? "Final interview booked" : "Interview booked"}
          </p>
          <p className="text-sm text-[#047857] mt-0.5">
            {when} ({booking.timezone})
          </p>
        </div>
      </div>
    );
  }

  // A time change is in flight: the recruiter moved the calendar event, so the
  // candidate was sent back to re-pick. Orange — waiting on the candidate again.
  if (booking && booking.status === "pending_reschedule") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-[#FED7AA] bg-[#FFF7ED] p-4"
      >
        <svg className="w-5 h-5 text-[#EA580C] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-[#9A3412]">Awaiting candidate re-confirmation</p>
          <p className="text-sm text-[#C2410C] mt-0.5">
            You moved the interview on your calendar. The candidate was emailed to pick a new time.
          </p>
        </div>
      </div>
    );
  }

  // Invited but not yet booked. Amber — action sits with the candidate.
  if (isFinal || status === "interview_scheduling") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4"
      >
        <svg className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-[#92400E]">Awaiting candidate booking</p>
          <p className="text-sm text-[#B45309] mt-0.5">
            The scheduling invite was sent. The candidate hasn&apos;t picked an interview slot yet.
          </p>
        </div>
      </div>
    );
  }

  // interview_scheduled without a booking row — e.g. set by a manual override.
  // Be honest rather than imply a slot exists.
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4"
    >
      <svg className="w-5 h-5 text-[#6B7280] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
      <div>
        <p className="text-sm font-semibold text-[#374151]">Marked as scheduled</p>
        <p className="text-sm text-[#6B7280] mt-0.5">
          No system booking is on file for this candidate.
        </p>
      </div>
    </div>
  );
}

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string; candidateId: string }>;
}) {
  const { id, candidateId } = await params;
  // Malformed ids in the URL → 404 before the parallel fetches run queries
  // (and log errors) against garbage uuids.
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(candidateId).success) {
    notFound();
  }

  const [campaign, candidate, screeningState, resumeCriteriaCount, booking, interviewSession, poolState, timeline] =
    await Promise.all([
      getCampaignById(id),
      getCandidateById(candidateId),
      getCandidateScreeningState(candidateId).catch(() => ({
        status: null,
        questions: [],
        response: null,
      })),
      getResumeCriteriaCount(id).catch(() => 0),
      getInterviewBooking(candidateId).catch(() => null),
      getInterviewSession(candidateId).catch(() => null),
      // Best-effort: the pool is a side note on this page, and a failure here
      // must not take the candidate record down with it.
      getCandidatePoolState(candidateId).catch(() => ({
        pooled: false,
        entryId: null,
        tags: [] as string[],
        notes: "",
      })),
      // Same posture: the history is the compliance record, but failing to read
      // it must not hide the candidate it belongs to.
      getCandidateTimeline(candidateId).catch(() => ({
        entries: [],
        hoursInCurrentState: null,
      })),
    ]);

  const hasResumeCriteria = resumeCriteriaCount > 0;

  if (!campaign || !candidate) {
    notFound();
  }

  // Candidate processing (score / send screening / approve) is frozen unless the
  // campaign is Active — gate the per-candidate actions, mirroring the server.
  const isActive = campaign.status === "active";

  const parsed = candidate.parsed_data;

  return (
    <div className="mx-auto max-w-7xl">
      {/* Breadcrumb */}
      <div className="flex items-baseline gap-2 text-sm text-[#6B7280] mb-4">
        <Link
          href="/campaigns"
          className="hover:text-[#2563EB] transition-colors duration-150"
        >
          Campaigns
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${id}`}
          className="hover:text-[#2563EB] transition-colors duration-150"
        >
          {campaign.title}
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${id}/candidates`}
          className="hover:text-[#2563EB] transition-colors duration-150"
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
            <div className="w-12 h-12 rounded-full bg-[#F3F4F6] flex items-center justify-center text-lg font-semibold text-[#111827]">
              {candidate.name
                .split(" ")
                .map((n: string) => n[0])
                .join("")}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-ink">
                  {candidate.name}
                </h1>
                <span className="inline-flex rounded-md border border-[#E5E7EB] bg-[#F3F4F6] px-2.5 py-0.5 text-xs font-medium text-[#4B5563]">
                  {formatApplicationState(candidate.status)}
                </span>
              </div>
              {(parsed?.headline || candidate.current_title) && (
                <p className="mt-0.5 text-sm text-[#6B7280]">
                  {parsed?.headline ??
                    `${candidate.current_title}${candidate.current_company ? ` at ${candidate.current_company}` : ""}`}
                </p>
              )}
              {/* One line instead of a five-row card: an email and a phone
                  number do not each need an icon and a row. */}
              <p className="mt-1 text-sm text-[#6B7280]">
                <a
                  href={`mailto:${candidate.email}`}
                  className="transition-colors duration-150 hover:text-primary"
                >
                  {candidate.email}
                </a>
                {candidate.phone && (
                  <>
                    {" · "}
                    <a
                      href={`tel:${candidate.phone}`}
                      className="transition-colors duration-150 hover:text-primary"
                    >
                      {candidate.phone}
                    </a>
                  </>
                )}
                {parsed?.location && ` · ${parsed.location}`}
                {` · applied ${new Date(candidate.applied_at).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", year: "numeric" },
                )}`}
              </p>
            </div>
          </div>
        </div>
        <Link
          href={`/campaigns/${id}/candidates`}
          className="btn-secondary shrink-0 text-sm"
        >
          Back to list
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Evidence column — everything that was read, in the order it
            arrived. It scrolls; the decision does not. */}
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {/* Contact facts live in the header line above — five rows of icons
              for an email and a phone number is a panel of chrome. What is left
              here is what a recruiter actually opens. */}
          {(candidate.linkedin_url ||
            parsed?.github_url ||
            candidate.portfolio_url) && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink">
                Links
              </h2>
              <div className="flex flex-wrap gap-2">
                {candidate.linkedin_url && (
                  <ProfileLink href={candidate.linkedin_url} label="LinkedIn" />
                )}
                {parsed?.github_url && (
                  <ProfileLink href={parsed?.github_url} label="GitHub" />
                )}
                {candidate.portfolio_url && (
                  <ProfileLink href={candidate.portfolio_url} label="Portfolio" />
                )}
              </div>
            </div>
          )}

          {/* Summary / About */}
          {parsed?.summary && (
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
              <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-3">
                About
              </h2>
              <p className="text-sm text-[#4B5563] leading-relaxed whitespace-pre-line">
                {parsed.summary}
              </p>
            </div>
          )}

          {/* Resume */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
                Resume
              </h2>
              {candidate.resume_url && (
                <a
                  href={candidate.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
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
              <ChipGroup label="Skills" items={parsed?.skills ?? candidate.resume.skills} />
              <ChipGroup label="Languages" items={parsed?.languages ?? []} />
              <ChipGroup label="Certifications" items={parsed?.certifications ?? []} />
              <ChipGroup label="Interests" items={parsed?.interests ?? []} />
            </div>
          </div>

          {!isActive && (
            <div className="flex items-start gap-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>
                This campaign is <span className="font-medium capitalize">{campaign.status}</span>.
                Scoring, screening sends and approvals are paused — set it to{" "}
                <span className="font-medium">Active</span> to act on this candidate. Rejecting is still available.
              </span>
            </div>
          )}

          <InterviewBookingBanner status={candidate.status} booking={booking} />

          {parsed && parsed.experience.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
              <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
                Experience
              </h2>
              <div className="space-y-4">
                {parsed.experience.map((exp, i) => (
                  <ExperienceEntry key={i} exp={exp} />
                ))}
              </div>
            </div>
          )}

          {parsed && parsed.education.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
              <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
                Education
              </h2>
              <div className="space-y-4">
                {parsed.education.map((edu, i) => (
                  <EducationEntry key={i} edu={edu} />
                ))}
              </div>
            </div>
          )}

          <ScreeningThread
            applicationId={candidateId}
            applicationStatus={screeningState.status}
            questions={screeningState.questions}
            response={screeningState.response}
            campaignActive={isActive}
          />

          <InterviewTranscript session={interviewSession} />

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
              {hasResumeCriteria ? (
                <p className="text-sm text-[#6B7280]">
                  No scores yet. This candidate hasn&apos;t been evaluated.
                </p>
              ) : (
                <>
                  <p className="text-sm text-[#6B7280]">
                    No criteria configured for this campaign — add screening
                    criteria to enable scoring.
                  </p>
                  <Link
                    href={`/campaigns/${id}/edit`}
                    className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
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
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Add screening criteria
                  </Link>
                </>
              )}
            </div>
          ) : (
            candidate.scores.map((score: CandidateScore, i: number) => (
              <ScoreCard
                key={i}
                score={score}
                applicationId={candidateId}
                campaignActive={isActive}
              />
            ))
          )}

          {/* Last in the column on purpose: the panel asks the manager to judge
              the evidence, so it sits below all of it rather than above. */}
          {candidate.status === "manager_review" && (
            <div id="manager-review" className="scroll-mt-6">
              <ManagerReviewPanel applicationId={candidateId} />
            </div>
          )}
        </div>

        {/* The decision rail. Pinned, because the evidence is long and the
            actions must be reachable from any depth of it — a decision you
            have to scroll back up to make is one you make from memory. */}
        <aside className="space-y-4 min-w-0 lg:sticky lg:top-6 lg:self-start">
          <StageScoresCard scores={candidate.scores} />

          <DecisionCard status={candidate.status}>
            {/* The stage-specific gate, when there is one. Each already owns
                its own written-rationale requirement. */}
            {candidate.awaiting_human_review && (
              <HitlReviewPanel
                applicationId={candidateId}
                campaignId={id}
                campaignActive={isActive}
                hasScreeningQuestions={screeningState.questions.length > 0}
                bare
              />
            )}

            {/* The manager's decision needs the full measure — a disposition
                code and a written reason do not fit a third of a page — so it
                lives under the evidence and the rail points at it. */}
            {candidate.status === "manager_review" && (
              <a
                href="#manager-review"
                className="btn-primary block text-center text-sm"
              >
                Make the decision
              </a>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <StageChanger
                applicationId={candidateId}
                currentState={candidate.status}
              />
              <TalentPoolButton
                applicationId={candidateId}
                candidateName={candidate.name}
                initialState={poolState}
              />
            </div>
          </DecisionCard>

          {/* The history is context for the judgement, so it sits with it. */}
          <ActivityTimelinePanel timeline={timeline} />
        </aside>
      </div>
    </div>
  );
}
