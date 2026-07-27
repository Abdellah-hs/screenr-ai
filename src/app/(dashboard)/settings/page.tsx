import {
  getGmailConnectionStatus,
  getLinkedInConnectionStatus,
} from "@/lib/actions/integrations";
import { GmailConnectionCard } from "@/components/settings/gmail-connection-card";
import { LinkedInConnectionCard } from "@/components/settings/linkedin-connection-card";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string; linkedin?: string }>;
}) {
  const [gmailStatus, linkedInStatus, { gmail, linkedin }] = await Promise.all([
    getGmailConnectionStatus(),
    getLinkedInConnectionStatus(),
    searchParams,
  ]);

  const gmailNotice = gmail === "connected" || gmail === "error" ? gmail : null;
  const linkedInNotice = linkedin === "connected" || linkedin === "error" ? linkedin : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#111827]">Settings</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Manage integrations and account preferences.
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#6B7280]">
          Integrations
        </h2>
        <div className="space-y-6">
          <GmailConnectionCard status={gmailStatus} notice={gmailNotice} />
          <LinkedInConnectionCard status={linkedInStatus} notice={linkedInNotice} />
        </div>
      </section>
    </div>
  );
}
