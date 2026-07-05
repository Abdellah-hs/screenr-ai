import {
  escapeHtml,
  firstNameOf,
  renderEmailLayout,
  type BuiltEmail,
} from "./shared";

export interface ApplicationReceivedEmailParams {
  candidateName: string;
  campaignTitle: string;
  companyName?: string;
}

/**
 * Confirmation sent to the candidate the moment their apply-form submission is
 * ingested. Pure receipt + expectations-setting: it must NOT hint at scores,
 * screening outcomes, or timelines the pipeline can't guarantee — the ingest
 * result (and any AI evidence) stays internal until a real transition emails
 * the candidate.
 */
export function buildApplicationReceivedEmail(
  params: ApplicationReceivedEmailParams,
): BuiltEmail {
  const { candidateName, campaignTitle, companyName = "the hiring team" } = params;
  const firstName = firstNameOf(candidateName);

  const subject = `We've received your application — ${campaignTitle}`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thank you for applying to the ${campaignTitle} role. This email confirms we've received your application and CV.`,
    ``,
    `What happens next: the hiring team will review your application, and if there's a fit you'll hear from us about the next steps. There's nothing you need to do right now.`,
    ``,
    `Thanks,`,
    `${companyName}`,
  ].join("\n");

  const html = renderEmailLayout(`
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
                  Thank you for applying to the <strong>${escapeHtml(campaignTitle)}</strong> role. This email confirms we&#39;ve received your application and CV.
                </p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.6;">
                  What happens next: the hiring team will review your application, and if there&#39;s a fit you&#39;ll hear from us about the next steps. There&#39;s nothing you need to do right now.
                </p>
                <p style="margin:24px 0 0; font-size:15px; line-height:1.6;">
                  Thanks,<br>
                  ${escapeHtml(companyName)}
                </p>`);

  return { subject, text, html };
}
