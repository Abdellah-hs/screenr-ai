import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidateById, getCandidatesByCampaignId } from "@/lib/actions/candidates";
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
import { CandidateHeader } from "@/components/candidates/candidate-header";
import {
  ParsedCvCard,
  InterviewNotTakenCard,
  NoResumeRubricCard,
} from "@/components/candidates/cv-evidence";
import ScreeningThread from "@/components/candidates/screening-thread";
import InterviewTranscript from "@/components/candidates/interview-transcript";
import { RescoreResumeButton } from "@/components/candidates/rescore-resume-button";
import {
  DecisionCard,
  StageScoresCard,
  RAIL_ACTION_PRIMARY,
} from "@/components/candidates/decision-rail";
import { ScoreSection } from "@/components/ui";
import {
  mandatoryDimensionNames,
  withInterviewScore,
  type ScoreStage,
} from "@/lib/candidates/detail-header";
import { toCandidateStage } from "@/lib/constants";
import { uuidSchema } from "@/lib/validations";
import type { CandidateScore } from "@/lib/constants";
import ResumeEvaluation from "@/components/candidates/resume-evaluation";
import type { InterviewBooking } from "@/lib/data/scheduling";
import type { ApplicationState } from "@/lib/constants";

/** Where each stage's evidence lives, so the rail can jump to it. */
const EVIDENCE_ANCHOR: Record<ScoreStage, string> = {
  resume: "cv-score",
  screening: "screening-score",
  interview: "interview-evidence",
};

const SECTION_COPY: Record<ScoreStage, { eyebrow: string; title: string; fallibility: string }> =
  {
    resume: {
      eyebrow: "CV · AI assessment",
      title: "CV score",
      fallibility: "An AI read the document and wrote this. It can be wrong, and it moved nobody.",
    },
    screening: {
      eyebrow: "Voice screening · AI assessment",
      title: "Screening score",
      fallibility:
        "An AI scored the transcript of a spoken call. It can be wrong, and it moved nobody.",
    },
    interview: {
      eyebrow: "AI interview · AI assessment",
      title: "Interview score",
      fallibility:
        "An AI scored the transcript. It can be wrong, it never gates, and it moved nobody.",
    },
  };

function provenanceOf(score: CandidateScore): string {
  const version = score.rubric_version === null ? "rubric —" : `rubric v${score.rubric_version}`;
  const at = new Date(score.scored_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${version} · ${at}`;
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

  // Booked — the candidate picked a slot. Emerald, with the confirmed time.
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
      <Banner
        tone="border-[#A7F3D0] bg-[#ECFDF5]"
        titleClass="text-[#065F46]"
        bodyClass="text-[#047857]"
        icon="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
        iconClass="text-[#059669]"
        title={isFinal ? "Final interview booked" : "Interview booked"}
        body={`${when} (${booking.timezone})`}
      />
    );
  }

  // A time change is in flight: the recruiter moved the calendar event, so the
  // candidate was sent back to re-pick. Waiting on the candidate again.
  if (booking && booking.status === "pending_reschedule") {
    return (
      <Banner
        tone="border-[#FED7AA] bg-[#FFF7ED]"
        titleClass="text-[#9A3412]"
        bodyClass="text-[#C2410C]"
        icon="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
        iconClass="text-[#EA580C]"
        title="Awaiting candidate re-confirmation"
        body="You moved the interview on your calendar. The candidate was emailed to pick a new time."
      />
    );
  }

  // Invited but not yet booked. Amber — action sits with the candidate.
  if (isFinal || status === "interview_scheduling") {
    return (
      <Banner
        tone="border-[#FDE68A] bg-[#FFFBEB]"
        titleClass="text-[#92400E]"
        bodyClass="text-[#B45309]"
        icon="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        iconClass="text-[#D97706]"
        title="Awaiting candidate booking"
        body="The scheduling invite was sent. The candidate hasn't picked an interview slot yet."
      />
    );
  }

  // `interview_scheduled` with no booking row — e.g. set by a manual override.
  // Be honest rather than imply a slot exists.
  return (
    <Banner
      tone="border-[#E5E7EB] bg-[#F9FAFB]"
      titleClass="text-[#374151]"
      bodyClass="text-[#6B7280]"
      icon="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
      iconClass="text-[#6B7280]"
      title="Marked as scheduled"
      body="No system booking is on file for this candidate."
    />
  );
}

function Banner({
  tone,
  titleClass,
  bodyClass,
  iconClass,
  icon,
  title,
  body,
}: {
  tone: string;
  titleClass: string;
  bodyClass: string;
  iconClass: string;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div role="status" className={`flex items-start gap-3 rounded-xl border p-4 ${tone}`}>
      <svg
        className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
      <div>
        <p className={`text-sm font-semibold ${titleClass}`}>{title}</p>
        <p className={`mt-0.5 text-[13px] ${bodyClass}`}>{body}</p>
      </div>
    </div>
  );
}

/**
 * One candidate's evidence file.
 *
 * Layout B from the design handoff, and the reason it was chosen is structural
 * rather than aesthetic: the evidence is long, and the three stage scores plus
 * the decision are pinned in a 352px rail so all three numbers stay comparable
 * from any scroll depth. That is what the no-composite-score rule actually
 * asks for — a manager reads *across* the stages, and a decision you have to
 * scroll back up to make is one you make from memory.
 */
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

  const [
    campaign,
    candidate,
    screeningState,
    booking,
    interviewSession,
    poolState,
    timeline,
    peers,
  ] = await Promise.all([
    getCampaignById(id),
    getCandidateById(candidateId),
    getCandidateScreeningState(candidateId).catch(() => ({
      status: null,
      questions: [],
      response: null,
    })),
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
    // Only for the prev/next stepper — losing it costs the stepper, nothing else.
    getCandidatesByCampaignId(id).catch(() => []),
  ]);

  if (!campaign || !candidate) {
    notFound();
  }

  // Candidate processing (score / send screening / approve) is frozen unless the
  // campaign is Active — gate the per-candidate actions, mirroring the server.
  const isActive = campaign.status === "active";
  const parsed = candidate.parsed_data;

  // The interview score lives on the session, not on the application, so the
  // rail has to be handed both or it under-reports a scored interview.
  const railScores = withInterviewScore(candidate.scores, interviewSession?.scores ?? null);
  const bucket = toCandidateStage(candidate.status);
  const hasSlaTimer = campaign.sla_timers.some((t) => t.stage === bucket);
  // The detail read does not compute an SLA breach; the list read does, and it
  // is already fetched for the stepper.
  const slaBreach = peers.find((p) => p.id === candidateId)?.sla ?? null;

  // An empty resume rubric means no CV on this campaign is ever scored — a
  // different fact from "this one has not been scored yet".
  const scoresResumes =
    (campaign.rubrics.find((r) => r.stage === "resume")?.dimensions.length ?? 0) > 0;

  const profiles = [
    candidate.linkedin_url && { label: "LinkedIn", href: candidate.linkedin_url },
    parsed?.github_url && { label: "GitHub", href: parsed.github_url },
    candidate.portfolio_url && { label: "Portfolio", href: candidate.portfolio_url },
  ].filter((p): p is { label: string; href: string } => Boolean(p));

  const resumeScore = candidate.scores.find((s) => s.stage === "resume");
  const screeningScore = candidate.scores.find((s) => s.stage === "screening");
  const rubricIsStale =
    resumeScore?.rubric_version != null &&
    resumeScore.current_rubric_version != null &&
    resumeScore.rubric_version !== resumeScore.current_rubric_version;

  const interviewTaken =
    interviewSession !== null &&
    !(interviewSession.status === "invited" && (interviewSession.transcript ?? []).length === 0);

  const headline =
    parsed?.headline ??
    (candidate.current_title
      ? `${candidate.current_title}${candidate.current_company ? ` at ${candidate.current_company}` : ""}`
      : null);

  return (
    <>
      <CandidateHeader
        campaignId={id}
        campaignTitle={campaign.title}
        candidate={candidate}
        headline={headline}
        location={parsed?.location ?? null}
        hoursInStage={timeline.hoursInCurrentState}
        sla={slaBreach}
        hasSlaTimer={hasSlaTimer}
        peers={peers}
      />

      <div className="mx-auto flex w-full max-w-[1440px] items-start gap-7 pb-20">
        {/* Evidence. Everything that was read, in the order it arrived. */}
        <main className="flex min-w-0 flex-1 flex-col gap-[22px]">
          {!isActive && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[13px] text-[#92400E]">
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span>
                This campaign is <span className="font-semibold capitalize">{campaign.status}</span>.
                Scoring, screening sends and approvals are paused — set it to{" "}
                <span className="font-semibold">Active</span> to act on this candidate.
                Rejecting is still available.
              </span>
            </div>
          )}

          <InterviewBookingBanner status={candidate.status} booking={booking} />

          {resumeScore && (
            <div id={EVIDENCE_ANCHOR.resume} className="scroll-mt-6">
              <ScoreSection
                eyebrow={SECTION_COPY.resume.eyebrow}
                title={SECTION_COPY.resume.title}
                score={resumeScore.overall}
                tier={resumeScore.tier}
                rationale={resumeScore.ai_summary}
                // Evidence-scored CVs have no weighted factors — the criteria
                // render below instead. An empty list keeps the block from
                // drawing a factor bar chart out of nothing.
                factors={resumeScore.evaluation ? [] : resumeScore.factors}
                mandatoryNames={mandatoryDimensionNames(campaign.rubrics, "resume")}
                fallibility={SECTION_COPY.resume.fallibility}
                provenance={provenanceOf(resumeScore)}
                links={[
                  { label: "Parsed CV", href: "#parsed-cv" },
                  ...(candidate.resume_url
                    ? [{ label: "Original document", href: candidate.resume_url }]
                    : []),
                ]}
              />

              {/* The per-criterion evidence behind the number: each criterion's
                  level, the quotes that survived verification, and every
                  must-have that failed. Absent on scores written by the
                  weighted scorer that predates evidence screening, which keep
                  their factor list above rather than being re-derived into
                  gates we never actually applied. */}
              {resumeScore.evaluation && (
                <div className="mt-3">
                  <ResumeEvaluation evaluation={resumeScore.evaluation} />
                </div>
              )}

              {/* The rubric moved after this score was written. Say so where the
                  score is, and offer the only thing that fixes it. */}
              {rubricIsStale && (
                <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5">
                  <p className="flex-1 text-xs leading-[1.55] text-[#92400E]">
                    Scored against rubric v{resumeScore.rubric_version}; the campaign
                    now runs v{resumeScore.current_rubric_version}. This number
                    answers a question you have since changed.
                  </p>
                  <RescoreResumeButton
                    applicationId={candidateId}
                    campaignActive={isActive}
                  />
                </div>
              )}
            </div>
          )}

          {!resumeScore && !scoresResumes && (
            <NoResumeRubricCard editHref={`/campaigns/${id}/edit`} />
          )}

          <div id="parsed-cv" className="scroll-mt-6">
            <ParsedCvCard
              parsed={parsed}
              fallbackSkills={candidate.resume.skills}
              resumeUrl={candidate.resume_url || null}
              profiles={profiles}
            />
          </div>

          {screeningScore && (
            <div id={EVIDENCE_ANCHOR.screening} className="scroll-mt-6">
              <ScoreSection
                eyebrow={SECTION_COPY.screening.eyebrow}
                title={SECTION_COPY.screening.title}
                score={screeningScore.overall}
                tier={screeningScore.tier}
                rationale={screeningScore.ai_summary}
                factors={screeningScore.factors}
                mandatoryNames={mandatoryDimensionNames(campaign.rubrics, "screening")}
                fallibility={SECTION_COPY.screening.fallibility}
                provenance={provenanceOf(screeningScore)}
              />
            </div>
          )}

          {/* The per-question answers, the transcript and the send/score
              controls. The score above is the summary; this is the evidence. */}
          <ScreeningThread
            applicationId={candidateId}
            applicationStatus={screeningState.status}
            questions={screeningState.questions}
            response={screeningState.response}
            campaignActive={isActive}
          />

          <div id={EVIDENCE_ANCHOR.interview} className="scroll-mt-6">
            {interviewTaken ? (
              <InterviewTranscript session={interviewSession} />
            ) : (
              <InterviewNotTakenCard status={candidate.status} />
            )}
          </div>

          {/* Last in the column on purpose: the panel asks the manager to judge
              the evidence, so it sits below all of it rather than above. */}
          {candidate.status === "manager_review" && (
            <div id="manager-review" className="scroll-mt-6">
              <ManagerReviewPanel applicationId={candidateId} />
            </div>
          )}
        </main>

        {/* The decision rail. Pinned, because the evidence is long and the
            actions must be reachable from any depth of it. */}
        <aside className="sticky top-6 flex w-[352px] flex-none flex-col gap-4">
          <StageScoresCard
            scores={railScores}
            status={candidate.status}
            hrefFor={(row) => `#${EVIDENCE_ANCHOR[row.key]}`}
          />

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
              <a href="#manager-review" className={RAIL_ACTION_PRIMARY}>
                Make the decision
              </a>
            )}

            <StageChanger
              applicationId={candidateId}
              currentState={candidate.status}
              trigger="action"
            />
            <TalentPoolButton
              applicationId={candidateId}
              candidateName={candidate.name}
              initialState={poolState}
              full
            />
          </DecisionCard>

          {/* The history is context for the judgement, so it sits with it. */}
          <ActivityTimelinePanel
            timeline={timeline}
            auditHref={`/admin/audit?campaignId=${id}`}
          />

          <p className="px-1 text-center text-xs text-[#9CA3AF]">
            <Link
              href={`/campaigns/${id}/candidates`}
              className="hover:text-ink hover:underline"
            >
              Back to all candidates
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}
