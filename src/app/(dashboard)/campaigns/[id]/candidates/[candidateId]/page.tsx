import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
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
import { CandidateHeader } from "@/components/candidates/candidate-header";
import { EvidenceNav, EvidenceStageSwitch } from "@/components/candidates/evidence-nav";
import { ProctoringReportPanel } from "@/components/candidates/proctoring-report";
import {
  BAR_ACTION_PRIMARY,
  SECTION_SCROLL_MARGIN,
} from "@/components/candidates/detail-layout";
import {
  ParsedCvView,
  InterviewNotTakenCard,
  NoResumeRubricCard,
  EvidenceAbsenceCard,
} from "@/components/candidates/cv-evidence";
import ScreeningThread from "@/components/candidates/screening-thread";
import InterviewTranscript from "@/components/candidates/interview-transcript";
import { RescoreResumeButton } from "@/components/candidates/rescore-resume-button";
import { RetryProcessingButton } from "@/components/candidates/retry-processing-button";
import { ScoreSection } from "@/components/ui";
import {
  interviewWasTaken,
  mandatoryDimensionNames,
  screeningCallWasTaken,
  screeningWasSent,
  stageScoreRows,
  withInterviewScore,
  NEVER_WATCHED,
  STAGE_ASSESSMENT_COPY,
  type ScoreStage,
} from "@/lib/candidates/detail-header";
import {
  CANDIDATE_DETAIL_TABS,
  candidateDetailHref,
  evidenceNavTree,
  resolveCandidateTab,
  resolveEvidenceView,
} from "@/lib/candidates/evidence-nav";
import {
  isRecoverableProcessingFailure,
  processingFailureOrigin,
} from "@/lib/rules/processing-failure";
import { uuidSchema } from "@/lib/validations";
import { cn } from "@/lib/utils";
import type { CandidateScore } from "@/lib/constants";
import ResumeEvaluation from "@/components/candidates/resume-evaluation";
import ScreeningEvaluation from "@/components/candidates/screening-evaluation";
import type { InterviewBooking } from "@/lib/data/scheduling";
import type { ApplicationState } from "@/lib/constants";

/** "the screening and the history", "a, b and c" — never a bare comma list. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

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
 * Layout A from the design handoff, with the sub-nav switching the panel rather
 * than scrolling it: the identity and the decision are pinned in a bar across
 * the top, the sidebar lists the evidence, and exactly one piece of it is
 * rendered at a time.
 *
 * One view at a time, rather than one long column, for two reasons. Reading a
 * transcript should not mean scrolling past a CV; and the selection lives in
 * the URL, so a particular reading can be linked, bookmarked and survives a
 * refresh — "here is the interview proctoring report" instead of "open the
 * candidate and scroll".
 *
 * Two things are held out of the switch on purpose. The decision panels are
 * not evidence — they are what the page is *for* — so they sit above whatever
 * is selected rather than hiding inside one view; and the three stage scores
 * live in the sidebar, where they stay comparable now that their evidence
 * cannot be seen side by side.
 */
export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; candidateId: string }>;
  searchParams: Promise<{ tab?: string | string[]; view?: string | string[] }>;
}) {
  const [{ id, candidateId }, query] = await Promise.all([params, searchParams]);
  // Malformed ids in the URL → 404 before the parallel fetches run queries
  // (and log errors) against garbage uuids.
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(candidateId).success) {
    notFound();
  }

  const tab = resolveCandidateTab(query.tab);
  const view = resolveEvidenceView(query.view);

  // Everything but the campaign and the candidate is best-effort: one failing
  // read must not take the whole file down with it. What it must also not do is
  // pass for an answer — a failed screening read used to render "No screening
  // call has been captured for this candidate", which is a claim about the
  // candidate rather than a report about the query, and the page said it in the
  // same voice it says true things. Each failure is now logged and named.
  const unreadable: string[] = [];
  const bestEffort = <T,>(what: string, read: Promise<T>, fallback: T): Promise<T> =>
    read.catch((err: unknown) => {
      console.error(`CandidateDetailPage: could not load ${what} for ${candidateId}:`, err);
      unreadable.push(what);
      return fallback;
    });

  const [
    campaign,
    candidate,
    screeningState,
    booking,
    interviewSession,
    poolState,
    timeline,
  ] = await Promise.all([
    getCampaignById(id),
    getCandidateById(candidateId),
    bestEffort("the screening", getCandidateScreeningState(candidateId), {
      status: null,
      questions: [],
      response: null,
    }),
    bestEffort("the interview booking", getInterviewBooking(candidateId), null),
    bestEffort("the AI interview", getInterviewSession(candidateId), null),
    bestEffort("the talent-pool status", getCandidatePoolState(candidateId), {
      pooled: false,
      entryId: null,
      tags: [] as string[],
      notes: "",
    }),
    bestEffort("the history", getCandidateTimeline(candidateId), {
      entries: [],
      hoursInCurrentState: null,
    }),
  ]);

  // Settled order is not source order, so a page that renders this list has to
  // sort it or the sentence reshuffles between two identical failures.
  unreadable.sort();

  if (!campaign || !candidate) {
    notFound();
  }

  // Candidate processing (score / send screening / approve) is frozen unless the
  // campaign is Active — gate the per-candidate actions, mirroring the server.
  const isActive = campaign.status === "active";
  const parsed = candidate.parsed_data;
  const basePath = `/campaigns/${id}/candidates/${candidateId}`;

  // The interview score lives on the session, not on the application, so the
  // sidebar has to be handed both or it under-reports a scored interview.
  const railScores = withInterviewScore(candidate.scores, interviewSession?.scores ?? null);
  const scoreRows = stageScoreRows(railScores, candidate.status);
  const absenceOf = (stage: ScoreStage): string =>
    scoreRows.find((row) => row.key === stage)?.detail ?? "Not scored yet";
  // An empty resume rubric means no CV on this campaign is ever scored — a
  // different fact from "this one has not been scored yet".
  const scoresResumes =
    (campaign.rubrics.find((r) => r.stage === "resume")?.dimensions.length ?? 0) > 0;

  const resumeScore = candidate.scores.find((s) => s.stage === "resume");
  // Evidence-scored CVs lead with the gate and label their number a ranking.
  // A legacy weighted score has no gate and really was a graded score, so it
  // keeps the big figure as its headline.
  const isEvidenceScored = resumeScore?.evaluation != null;
  const screeningScore = candidate.scores.find((s) => s.stage === "screening");
  const rubricIsStale =
    resumeScore?.rubric_version != null &&
    resumeScore.current_rubric_version != null &&
    resumeScore.rubric_version !== resumeScore.current_rubric_version;

  // Whether each stage actually happened, which is what decides between the
  // evidence and a named absence — so a view never renders an empty white box.
  // Pure and tested in `detail-header.ts`: the page and the components used to
  // hold the same three conditions independently, and a drift between them
  // shows up as a blank panel with nothing to explain it.
  const interviewTaken = interviewWasTaken(interviewSession);
  const screeningThreadShown = screeningWasSent(screeningState.response);
  const screeningCallTaken = screeningCallWasTaken(screeningState.response);
  const screeningReport = screeningState.response?.proctoring ?? null;
  const interviewReport = interviewSession?.proctoring ?? null;

  const isManagerReview = candidate.status === "manager_review";

  // Read off the history the page already loaded rather than a query of its
  // own: `processing_failed` is reached from three different steps and only the
  // ingest one is repaired by re-reading the CV. The server action re-derives
  // this from the transitions log, so a stale page cannot talk it into
  // discarding a screening.
  const canRetryProcessing = isRecoverableProcessingFailure({
    status: candidate.status,
    failedFrom: processingFailureOrigin(timeline.entries),
  });

  // Both decision panels are rendered inside the evidence tab, so the header's
  // buttons have to name that tab as well as the anchor.
  const decisionHref = candidateDetailHref(basePath, "evidence", view);

  const navTree = evidenceNavTree({
    scores: railScores,
    status: candidate.status,
    screeningProctored: screeningReport !== null,
    interviewProctored: interviewReport !== null,
    // Both bars, kept apart, because they are not the same kind of number — and
    // the interview sets none, which is why there is no third entry here.
    thresholds: {
      resume: campaign.resume_threshold,
      screening: campaign.screening_threshold,
    },
  });

  return (
    // The same measure as the candidates list this page is opened from, so the
    // breadcrumb, the title and the panels below land on exactly the same left
    // edge when you click through from one to the other.
    //
    // The page does NOT claim the shell's height. It used to (`lg:h-full`),
    // which pinned the identity band and gave the evidence a scroller of its
    // own — and that is what broke reading it: the wheel did nothing unless the
    // pointer happened to be inside the right-hand pane, and on a short window
    // that pane was a few hundred pixels tall, so a score, a rubric breakdown
    // and a transcript all had to be read through a letterbox. One page, one
    // scrollbar — and now one column, since the evidence switch sits across the
    // top of the file rather than down the side of it.
    <div className="mx-auto flex max-w-5xl flex-col">
      <CandidateHeader
        campaignId={id}
        campaignTitle={campaign.title}
        candidate={candidate}
        location={parsed?.location ?? candidate.location}
        actions={
          <>
            <TalentPoolButton
              applicationId={candidateId}
              candidateName={candidate.name}
              initialState={poolState}
              size="bar"
            />

            <StageChanger
              applicationId={candidateId}
              currentState={candidate.status}
              trigger="bar"
            />

            {/* Ink only where a decision is actually owed. Both gates need a
                written rationale and a disposition code, which do not fit in a
                header — so the bar points at the panel rather than shrinking
                the decision to fit beside a breadcrumb.

                They are Links to the evidence tab, not bare `#` anchors: the
                panels live inside that tab, and the page opens on Parsed CV —
                so on the default tab a bare anchor pointed at an element that
                was not rendered, and the two most consequential buttons on the
                page did nothing at all. */}
            {candidate.awaiting_human_review && (
              <Link href={`${decisionHref}#hitl-review`} className={BAR_ACTION_PRIMARY}>
                Review and decide
              </Link>
            )}

            {isManagerReview && (
              <Link href={`${decisionHref}#manager-review`} className={BAR_ACTION_PRIMARY}>
                Make the decision
              </Link>
            )}
          </>
        }
      />

      {/* Two halves of the page, one level above the evidence file: what has
          been concluded about this person, and what they said about themselves.
          Links, not buttons — the tab is a URL, so this stays a Server
          Component and Back works. */}
      <nav
        aria-label="Candidate sections"
        className="mb-6 flex flex-none items-center gap-1 border-b border-[#E5E7EB]"
      >
        {CANDIDATE_DETAIL_TABS.map((t, i) => {
          const current = t.key === tab;
          return (
            <Link
              key={t.key}
              // The evidence selection rides along through the parsed tab and
              // back, so stepping over to the CV and returning does not lose
              // your place in the file.
              href={candidateDetailHref(basePath, t.key, view)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2.5 pt-1 text-[13px] font-semibold transition-colors duration-150",
                // The first tab loses its left padding so its label — and the
                // rule under it — start on the page's own left edge, in line
                // with the breadcrumb, the avatar and the panels below.
                i === 0 ? "pr-3.5" : "px-3.5",
                current
                  ? "border-ink text-ink"
                  : "border-transparent text-[#6B7280] hover:text-ink",
              )}
            >
              {t.label}
              {/* Only History is counted, and it is counted quietly. The figure
                  tallies events rather than grading anything, so it must never
                  take the weight of the three scores a tab away. Hidden at zero:
                  "History 0" is a worse thing to read than "History". */}
              {t.key === "history" && timeline.entries.length > 0 && (
                <span className="ml-1.5 text-[11px] font-medium tabular-nums text-[#9CA3AF]">
                  {timeline.entries.length}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Above the tabs' content, not inside one of them: a read that failed is
          a fact about the whole file, and the last thing to hide behind a tab
          the reader may never open. Named rather than counted, because "the
          screening" and "the history" fail in ways worth telling apart. */}
      {unreadable.length > 0 && (
        <div
          role="status"
          className="mb-6 flex flex-none items-start gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[13px] leading-[1.55] text-[#92400E]"
        >
          <svg
            className="mt-0.5 h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            />
          </svg>
          <span>
            Could not load {formatList(unreadable)}. Those sections are showing
            as empty because the read failed, <span className="font-semibold">not</span>{" "}
            because there is nothing on file. Reload to try again.
          </span>
        </div>
      )}

      {tab === "parsed" ? (
        <div className="pb-20">
          <ParsedCvView
            parsed={parsed}
            fallbackSkills={candidate.resume.skills}
            fallbackHeadline={
              candidate.current_title
                ? `${candidate.current_title}${candidate.current_company ? ` at ${candidate.current_company}` : ""}`
                : null
            }
            resumeUrl={candidate.resume_url || null}
            email={candidate.email}
            phone={candidate.phone}
            location={candidate.location}
            linkedinUrl={candidate.linkedin_url}
            githubUrl={candidate.github_url}
            portfolioUrl={candidate.portfolio_url}
          />
        </div>
      ) : tab === "history" ? (
        // The audit trail, at the page's full measure like the other two tabs.
        // It is not evidence and gets no strip above it: nothing here is a
        // reading of the candidate, so there is no stage to switch between.
        <div className="pb-20">
          <ActivityTimelinePanel
            timeline={timeline}
            auditHref={`/admin/audit?campaignId=${id}`}
            density="page"
          />
        </div>
      ) : (
      // One column. The evidence switch is a strip across the top, so the panel
      // below it gets the page's full measure — which is what a criterion row,
      // its meter, its evidence level and its quote were always short of while
      // a 222px index held a column of its own down the left, empty for most of
      // its height.
      <div className="flex flex-col gap-[22px] pb-20">
        <EvidenceNav tree={navTree} active={view} basePath={basePath} />

        {/* No scroller of its own. A screening thread or a transcript runs
            long, and it scrolls with the page. */}
        <main className="flex min-w-0 flex-col gap-[22px]">
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

          {/* Our extractor failed on this CV, so the candidate is filed but
              unread. Outside the evidence switch on purpose: there IS no
              evidence yet, and the one action that can produce some must not
              be hidden behind whichever view happens to be selected. */}
          {canRetryProcessing && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4"
            >
              <svg
                className="mt-0.5 h-5 w-5 shrink-0 text-[#D97706]"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                />
              </svg>
              <div>
                <p className="text-sm font-semibold text-[#92400E]">
                  This CV hasn&apos;t been read yet
                </p>
                <p className="mt-0.5 text-[13px] text-[#B45309]">
                  Processing failed on our side — the extractor timed out or a service was
                  unavailable. Nothing is wrong with the application: the CV is stored and
                  the details below came from the apply form. Try again to read it and
                  score it.
                </p>
                <div className="mt-3">
                  <RetryProcessingButton applicationId={candidateId} campaignActive={isActive} />
                </div>
              </div>
            </div>
          )}

          {/* Outside the switch on purpose: a decision that is owed must not be
              reachable only from whichever view happens to be selected. Each
              already owns its own written-rationale requirement. */}
          {candidate.awaiting_human_review && (
            <div id="hitl-review" className={SECTION_SCROLL_MARGIN}>
              <HitlReviewPanel
                applicationId={candidateId}
                campaignId={id}
                campaignActive={isActive}
                hasScreeningQuestions={screeningState.questions.length > 0}
              />
            </div>
          )}

          {isManagerReview && (
            <div id="manager-review" className={SECTION_SCROLL_MARGIN}>
              <ManagerReviewPanel applicationId={candidateId} />
            </div>
          )}

          {/* ── The selected evidence, and nothing else ─────────────────── */}

          {/* Heads the evidence, not the page: it belongs below the decision
              panels because it switches the reading, not the decision. A stage
              with only one reading renders nothing here. */}
          <EvidenceStageSwitch tree={navTree} active={view} basePath={basePath} />

          {view === "cv" &&
            (resumeScore ? (
              <>
                <ScoreSection
                  eyebrow={STAGE_ASSESSMENT_COPY.resume.eyebrow}
                  title={STAGE_ASSESSMENT_COPY.resume.title}
                  score={resumeScore.overall}
                  tier={resumeScore.tier}
                  // Evidence-scored CVs lead with the gate, not the number: the
                  // two say different things and the number is the lesser one.
                  // A legacy weighted score has no gate, so it keeps the figure
                  // as its headline — that is what it always was.
                  lead={isEvidenceScored ? "verdict" : "score"}
                  scoreLabel={isEvidenceScored ? "Ranking" : undefined}
                  emptyScoreText={isEvidenceScored ? "Not ranked" : "Not scored"}
                  rationale={resumeScore.ai_summary}
                  // Evidence-scored CVs have no weighted factors — the criteria
                  // render below instead. An empty list keeps the block from
                  // drawing a factor bar chart out of nothing.
                  factors={resumeScore.evaluation ? [] : resumeScore.factors}
                  mandatoryNames={mandatoryDimensionNames(campaign.rubrics, "resume")}
                  fallibility={STAGE_ASSESSMENT_COPY.resume.fallibility}
                  provenance={provenanceOf(resumeScore)}
                />

                {/* The per-criterion evidence behind the number: each criterion's
                    level, the quotes that survived verification, and every
                    must-have that failed. Absent on scores written by the
                    weighted scorer that predates evidence screening, which keep
                    their factor list above rather than being re-derived into
                    gates we never actually applied. */}
                {resumeScore.evaluation && (
                  <ResumeEvaluation
                    evaluation={resumeScore.evaluation}
                    resumeThreshold={campaign.resume_threshold}
                  />
                )}

                {/* The rubric moved after this score was written. Say so where
                    the score is, and offer the only thing that fixes it. */}
                {rubricIsStale && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5">
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
              </>
            ) : !scoresResumes ? (
              <NoResumeRubricCard editHref={`/campaigns/${id}/edit`} />
            ) : (
              <EvidenceAbsenceCard
                title={absenceOf("resume")}
                body="No CV score is on file. The document itself, and every field pulled out of it, is on the Parsed CV tab."
              />
            ))}

          {view === "screening" &&
            (screeningScore || screeningThreadShown ? (
              <>
                {screeningScore && (
                  <ScoreSection
                    eyebrow={STAGE_ASSESSMENT_COPY.screening.eyebrow}
                    title={STAGE_ASSESSMENT_COPY.screening.title}
                    score={screeningScore.overall}
                    tier={screeningScore.tier}
                    rationale={screeningScore.ai_summary}
                    factors={screeningScore.factors}
                    fallibility={STAGE_ASSESSMENT_COPY.screening.fallibility}
                    provenance={provenanceOf(screeningScore)}
                  />
                )}

                {/* The per-dimension evidence behind the number: each rubric
                    dimension's level, the verified quotes, and the overall
                    against this campaign's screening bar. Absent for a response
                    scored per question — anything before 2026-08-22 and the
                    legacy typed path — which keeps rendering in the unit it was
                    actually graded in, down in the thread. */}
                {screeningState.response?.dimension_scores?.length ? (
                  <ScreeningEvaluation
                    dimensions={screeningState.response.dimension_scores}
                    overallScore={screeningState.response.overall_score}
                    screeningThreshold={campaign.screening_threshold}
                    // Answers the call heard and failed to transcribe. Absent
                    // on every call taken before this was counted, which reads
                    // as 0 — nothing observed it then, so claiming otherwise
                    // would be inventing a fault we never detected.
                    unheardAnswers={
                      screeningState.response.topic_state?.unheardAnswers ?? 0
                    }
                  />
                ) : null}

                {/* The score above is the summary; this is the evidence — the
                    answers, the transcript, and the send/score controls. */}
                <ScreeningThread
                  applicationId={candidateId}
                  applicationStatus={screeningState.status}
                  questions={screeningState.questions}
                  response={screeningState.response}
                  campaignActive={isActive}
                />
              </>
            ) : (
              <EvidenceAbsenceCard
                title={absenceOf("screening")}
                body="No screening call has been captured for this candidate, so there is no transcript and no score to read."
              />
            ))}

          {view === "screening-proctoring" &&
            (screeningCallTaken ? (
              <ProctoringReportPanel
                report={screeningReport}
                stage="screening"
                showWhenAbsent
              />
            ) : (
              <EvidenceAbsenceCard
                title="Never monitored"
                body={`No screening call has been taken, so the browser signals this stage watches for were never collected. ${NEVER_WATCHED}`}
              />
            ))}

          {view === "interview" &&
            (interviewTaken ? (
              <InterviewTranscript
                session={interviewSession}
                applicationId={candidateId}
                campaignActive={isActive}
              />
            ) : (
              <InterviewNotTakenCard status={candidate.status} />
            ))}

          {view === "interview-proctoring" &&
            (interviewTaken ? (
              <ProctoringReportPanel
                report={interviewReport}
                stage="interview"
                showWhenAbsent
                snapshotUrls={interviewSession?.snapshot_urls}
              />
            ) : (
              <EvidenceAbsenceCard
                title="Never monitored"
                body={`No AI interview has run. ${NEVER_WATCHED}`}
              />
            ))}

        </main>
      </div>
      )}
    </div>
  );
}
