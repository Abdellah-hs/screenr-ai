import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getScreeningQuestions } from "@/lib/actions/screening-questions";
import { getLinkedInConnectionStatus } from "@/lib/actions/integrations";
import { CampaignApplyLink } from "@/components/campaigns/campaign-apply-link";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { SocialPostGenerator } from "@/components/campaigns/social-post-generator";
import {
  StepMark,
  WizardBrandHeader,
  WizardCloseLink,
  WizardRail,
} from "@/components/campaigns/wizard-chrome";
import { SHARE_STAGE, wizardRail } from "@/lib/campaigns/wizard";
import { applyGateBlocker, type ApplyGateBlocker } from "@/lib/rules/campaign-status";

export const metadata: Metadata = {
  title: "Share campaign · Screenr AI",
};

/**
 * The last stage of creating a campaign: here is the link, here is something to
 * post it with.
 *
 * It has to live after the write rather than inside the wizard, and that is not
 * a routing convenience — `public_slug` is minted by the insert, so there is no
 * apply link to show until the campaign row exists. A "share" step drawn among
 * the other five could only ever have shown a placeholder.
 *
 * In `(focus)` alongside the wizard, for the same reason the wizard is: one
 * task, one way out. The recruiter reaches the dashboard through the button at
 * the bottom, not by wandering off a sidebar halfway through copying a URL.
 */
/**
 * What the status pill beside this note means for the link below it. Keyed by
 * the shut intake gate, because "Active" alone does not say whether the link
 * takes CVs — and this is the moment the recruiter goes off to share it.
 */
const SHARE_STATUS_NOTE: Record<"open" | ApplyGateBlocker, string> = {
  open: "Applications through the link below enter the pipeline straight away.",
  not_active:
    "Set this to “Active — accepting applications” before you share the link — until then the apply page turns candidates away.",
  intake_closed:
    "This campaign is Active but closed to new applications, so the link below turns candidates away. Switch it to “Active — accepting applications” first.",
  deadline_passed:
    "The enforced deadline has passed, so the link below turns candidates away. Extend it, or stop enforcing it, before you share.",
};

export default async function ShareCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Owner-scoped in the action; a campaign the viewer does not own is a 404,
  // exactly as it is on the detail page.
  const [campaign, questions, linkedInStatus] = await Promise.all([
    getCampaignById(id),
    getScreeningQuestions(id),
    getLinkedInConnectionStatus(),
  ]);

  if (!campaign) notFound();

  // The link is live only when all three intake gates are open, not merely when
  // the status says Active — the wizard can leave a campaign Active with intake
  // switched off, and this page's whole job is telling the truth about the link
  // it is handing over.
  const applyBlocker = applyGateBlocker(campaign, new Date());
  const stages = wizardRail(false);

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-ink">
      {/* Literally the wizard's own brand row, not a copy of it. This is the
          end of that flow, so it must not arrive looking like a different
          product — and a copy is exactly how it would, since whoever restyles
          the wizard has no reason to open this file. */}
      <WizardBrandHeader>
        <WizardCloseLink
          href={`/campaigns/${campaign.id}`}
          label="Close and go to the campaign"
        />
      </WizardBrandHeader>

      <div className="mx-auto w-full max-w-[760px] px-6 pb-20 pt-8">
        {/* The same rail the wizard drew, at the same length — this stage was
            greyed out on it from step one, so arriving here only fills the mark
            that was already there. Static, unlike the wizard's: there is
            nothing left to go back and change, and the campaign is saved either
            way. */}
        {/* The same rail the wizard drew, at the same length — this stage was
            greyed out on it from step one, so arriving here only fills the mark
            that was already there. Static cells, unlike the wizard's: there is
            nothing left to go back and change, and the campaign is saved either
            way. */}
        <WizardRail stages={stages}>
          {(stage, i) => (
            <span
              aria-current={stage.form ? undefined : "step"}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2"
            >
              <StepMark index={i} position={stage.form ? "past" : "current"} />
              <span
                className={`hidden truncate text-[13px] sm:inline ${
                  stage.form ? "font-medium text-[#6B7280]" : "font-semibold text-ink"
                }`}
              >
                {stage.label}
              </span>
            </span>
          )}
        </WizardRail>

        <main className="mt-8">
          <p className="mb-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[#047857]">
            {campaign.title} · Created
          </p>
          <h1 className="mb-2 font-heading text-[30px] font-semibold tracking-[-0.02em]">
            {SHARE_STAGE.title}
          </h1>
          <p className="mb-6 max-w-[62ch] text-sm leading-[1.6] text-[#6B7280]">
            Everything you decided is saved and the pipeline is wired up. All
            that is missing is candidates.
          </p>

          {/* The status is the difference between a link that works and a link
              that does not, so it is settable here rather than one page away.
              The wizard's default is Draft, which is the case this exists for. */}
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-[22px] py-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <CampaignStatusChanger
              campaignId={campaign.id}
              currentStatus={campaign.status ?? "draft"}
              acceptingApplications={campaign.accepting_applications}
              applyBlocker={applyBlocker}
            />
            <p className="min-w-0 flex-1 text-[13px] leading-[1.55] text-[#6B7280]">
              {SHARE_STATUS_NOTE[applyBlocker ?? "open"]}
            </p>
          </div>

          <div className="flex flex-col gap-6">
            {campaign.public_slug ? (
              <CampaignApplyLink slug={campaign.public_slug} blocker={applyBlocker} />
            ) : (
              <div className="rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                  Public apply link
                </h2>
                <p className="text-[13px] leading-[1.55] text-[#6B7280]">
                  This campaign has no public apply link, so there is no page to
                  share and a drafted post will not carry one.
                </p>
              </div>
            )}

            <SocialPostGenerator
              title={campaign.title}
              description={campaign.description}
              department={campaign.department}
              location={campaign.location}
              slug={campaign.public_slug}
              linkedInConnected={linkedInStatus.connected}
            />
          </div>

          {/* Named here because sharing the link is what makes it urgent: from
              this moment candidates can apply, and nobody can be approved into
              screening until the campaign has questions. */}
          {questions.length === 0 && (
            <div className="mt-6 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[22px] py-4">
              <p className="mb-1 text-[13px] font-semibold text-[#92400E]">
                This campaign has no screening questions
              </p>
              <p className="text-[13px] leading-[1.55] text-[#92400E]">
                Candidates can apply, but none of them can be approved into
                screening until it has some. You can add them on the campaign
                page.
              </p>
            </div>
          )}
        </main>

        <div className="mt-8 flex items-center justify-end border-t border-[#E5E7EB] pt-6">
          <Link
            href={`/campaigns/${campaign.id}`}
            className="inline-flex min-h-[46px] items-center rounded-lg border border-ink bg-ink px-[22px] text-sm font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            Go to the campaign
          </Link>
        </div>
      </div>
    </div>
  );
}
