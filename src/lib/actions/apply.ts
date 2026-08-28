"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestOrigin } from "@/lib/http/origin";
import { fetchCampaignBySlug } from "@/lib/data/campaigns";
import { isCampaignAcceptingApplications } from "@/lib/rules/campaign-status";
import { isSupportedResumeMimeType } from "@/lib/resume-ingest/mime";
import {
  ingestResumeDocument,
  type ApplicantIdentity,
  type IngestRejectionReason,
} from "@/lib/resume-ingest/ingest-resume";
import { applyApplicantSchema } from "@/lib/validations";
import { getRecruiterGmailClient } from "./gmail-sender";
import { sendEmail } from "@/lib/services/email";
import { buildApplicationReceivedEmail } from "@/lib/services/email-templates/application-received";
import { buildApplicationProblemEmail } from "@/lib/services/email-templates/application-problem";
import type { BuiltEmail } from "@/lib/services/email-templates/shared";

// Candidate-facing brand on the apply flow (confirmation email signature and
// From display name). The ATS is internal to MatiousCorp, so this is fixed.
const COMPANY_NAME = "Matious";

// Resumes are small; 10 MB is generous and keeps an abusive upload from buffering
// a huge file into memory before we even look at it.
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

// A handful of submissions per IP per window — enough for a genuine candidate who
// re-uploads after a rejection, low enough to blunt scripted abuse of a public link.
const APPLY_RATE_LIMIT = {
  name: "apply-submit",
  maxRequests: 5,
  windowMs: 10 * 60 * 1000,
} as const;

// Candidate-facing copy. Neutral by design — a public page must not leak the
// internal campaign status word or hint at why a role is closed.
const NOT_FOUND_MESSAGE =
  "We couldn't find this opening. Please double-check the link, or contact the hiring team.";
const CLOSED_MESSAGE =
  "This role isn't accepting applications right now. Please check back later or contact the hiring team.";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/** Map a non-blocking ingest rejection to candidate-facing, actionable copy. */
function rejectionMessage(reason: IngestRejectionReason): string {
  switch (reason) {
    case "not_a_cv":
      return "That file doesn't look like a CV or resume. Please upload your CV and try again.";
    case "no_email":
      return "We couldn't find an email address on your CV. Add your contact email and re-upload so the hiring team can reach you.";
    case "unreadable":
      return "We couldn't read that file. Please upload a clear PDF or Word document.";
  }
}

/**
 * Strip a candidate-supplied filename down to a safe storage-key component —
 * it gets concatenated into a Supabase storage path, so a stray `/` or `..`
 * must never reach it. Keeps a readable basename + extension, caps the length,
 * and falls back to a generic name when nothing safe survives.
 */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "").slice(0, 120);
  return cleaned || "resume.pdf";
}

export interface ApplyContext {
  campaign_title: string;
  /** Whether the campaign is Active and therefore taking applications right now. */
  is_accepting: boolean;
}

/**
 * Backs the public apply page (`/apply/[slug]`). Session-less lookup of a
 * campaign by its `public_slug` — read-only, so it's safe on every page load.
 * Returns whether the role is currently accepting so the page can show the
 * upload form or a neutral "not accepting" state. Throws a candidate-facing
 * message when the slug matches no campaign.
 */
export async function loadApplyContext(slug: string): Promise<ApplyContext> {
  const campaign = await fetchCampaignBySlug(slug);
  if (!campaign) throw new Error(NOT_FOUND_MESSAGE);

  return {
    campaign_title: campaign.title,
    is_accepting: isCampaignAcceptingApplications(campaign, new Date()),
  };
}

/**
 * Public CV submission from the apply page. Candidates have no account, so this
 * runs on the service-role client after validating the upload and re-checking
 * the campaign is Active (the freeze rule applies candidate-side too).
 *
 * Only the cheap checks (presence, type, size, rate limit, campaign active)
 * run inside the request — the response is instant. The expensive pipeline
 * (`ingestResumeDocument`: Marker extraction → OpenAI classify → upload →
 * score → advance) runs in `after()`, once the candidate already has their
 * confirmation. A rejection (not a CV, no email, unreadable) therefore can't
 * be shown inline anymore: the applicant gets an actionable "apply again"
 * email instead (product decision 2026-07-10).
 *
 * A failure of OURS is not a rejection and never asks them to re-apply: the
 * ingest files them in `processing_failed` and this sends the ordinary
 * receipt. The only path that still says "try again" is one where nothing
 * could be written at all.
 */
export async function submitApplication(formData: FormData): Promise<{ ok: true }> {
  const slug = String(formData.get("slug") ?? "").trim();
  const file = formData.get("resume");

  if (!slug || slug.length > 200) throw new Error(NOT_FOUND_MESSAGE);
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Please attach your CV before submitting.");
  }

  // Self-declared identity — validated here, authoritative over CV extraction.
  const parsedApplicant = applyApplicantSchema.safeParse({
    first_name: String(formData.get("first_name") ?? ""),
    last_name: String(formData.get("last_name") ?? ""),
    email: String(formData.get("email") ?? ""),
    linkedin: String(formData.get("linkedin") ?? ""),
    website: String(formData.get("website") ?? ""),
  });
  if (!parsedApplicant.success) {
    throw new Error(
      parsedApplicant.error.issues[0]?.message ?? "Please check your details and try again.",
    );
  }
  const applicant: ApplicantIdentity = {
    first_name: parsedApplicant.data.first_name,
    last_name: parsedApplicant.data.last_name,
    email: parsedApplicant.data.email,
    linkedin_url: parsedApplicant.data.linkedin,
    portfolio_url: parsedApplicant.data.website,
  };

  // Rate-limit by IP before reading the file body or touching the database.
  const ip = await getClientIp();
  checkRateLimit(ip, APPLY_RATE_LIMIT);

  if (!isSupportedResumeMimeType(file.type)) {
    throw new Error("Please upload your CV as a PDF or Word (.docx) document.");
  }
  if (file.size > MAX_RESUME_BYTES) {
    throw new Error("That file is too large. Please upload a CV under 10 MB.");
  }

  const db = createAdminClient();

  const campaign = await fetchCampaignBySlug(slug, db);
  if (!campaign) throw new Error(NOT_FOUND_MESSAGE);
  if (!isCampaignAcceptingApplications(campaign, new Date())) throw new Error(CLOSED_MESSAGE);

  const buffer = Buffer.from(await file.arrayBuffer());

  // Absolute "apply again" link for the problem email — resolved now, not
  // inside the deferred work.
  const applyUrl = `${await getRequestOrigin()}/apply/${encodeURIComponent(slug)}`;

  // The candidate's part is done. Everything slow — Marker extraction, OpenAI
  // classification + scoring, the storage upload, and the emails — runs after
  // the response, so submitting feels instant.
  after(async () => {
    try {
      const result = await ingestResumeDocument({
        db,
        campaignId: campaign.campaign_id,
        ownerUserId: campaign.user_id,
        filename: safeFilename(file.name),
        mimeType: file.type,
        buffer,
        applicant,
        source: "apply_form",
      });

      // Our pipeline broke, not their CV. They are filed and a recruiter can
      // see them, so the honest thing to send is the ordinary receipt — which
      // promises only that the team will review the application, and that is
      // exactly what now happens. Telling them to apply again would be asking
      // a candidate to fix our outage, and would file them twice.
      if (result.outcome === "processing_failed") {
        await sendApplicantEmail({
          db,
          ownerUserId: campaign.user_id,
          applicantEmail: applicant.email,
          email: buildApplicationReceivedEmail({
            candidateName: `${applicant.first_name} ${applicant.last_name}`,
            campaignTitle: campaign.title,
            companyName: COMPANY_NAME,
          }),
        });
        return;
      }

      if (result.outcome === "rejected") {
        await sendApplicantEmail({
          db,
          ownerUserId: campaign.user_id,
          applicantEmail: applicant.email,
          email: buildApplicationProblemEmail({
            candidateName: `${applicant.first_name} ${applicant.last_name}`,
            campaignTitle: campaign.title,
            reasonMessage: rejectionMessage(result.reason),
            applyUrl,
            companyName: COMPANY_NAME,
          }),
        });
        return;
      }

      await sendApplicantEmail({
        db,
        ownerUserId: campaign.user_id,
        applicantEmail: applicant.email,
        email: buildApplicationReceivedEmail({
          candidateName: `${applicant.first_name} ${applicant.last_name}`,
          campaignTitle: campaign.title,
          companyName: COMPANY_NAME,
        }),
      });
    } catch (err) {
      // Infra failure mid-pipeline: the candidate already got a success
      // screen, so tell them to retry rather than leaving them ghosted.
      console.error(
        `submitApplication: background ingest failed for ${applicant.email}:`,
        err instanceof Error ? err.message : err,
      );
      await sendApplicantEmail({
        db,
        ownerUserId: campaign.user_id,
        applicantEmail: applicant.email,
        email: buildApplicationProblemEmail({
          candidateName: `${applicant.first_name} ${applicant.last_name}`,
          campaignTitle: campaign.title,
          reasonMessage:
            "Something went wrong on our side while processing your CV. Please try applying again.",
          applyUrl,
          companyName: COMPANY_NAME,
        }),
      });
    }
  });

  return { ok: true };
}

/**
 * Best-effort candidate email from the campaign owner's connected Gmail
 * (admin client — there is no session here). Failures log and return; they
 * must never crash the deferred pipeline.
 */
async function sendApplicantEmail(args: {
  db: SupabaseDb;
  ownerUserId: string;
  applicantEmail: string;
  email: BuiltEmail;
}): Promise<void> {
  try {
    // Throws when the owner has no inbox connected; caught below so a missing
    // connection just skips the email rather than crashing the pipeline.
    const gmail = await getRecruiterGmailClient(args.ownerUserId, args.db);
    await sendEmail(gmail, {
      to: args.applicantEmail,
      subject: args.email.subject,
      html: args.email.html,
      text: args.email.text,
      fromName: `${COMPANY_NAME} Recruiting`,
    });
  } catch (err) {
    console.error("submitApplication: applicant email failed (non-blocking):", err);
  }
}
