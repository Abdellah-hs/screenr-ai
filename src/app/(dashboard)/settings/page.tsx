import { getGmailConnectionStatus } from "@/lib/actions/integrations";
import { GmailConnectionCard } from "@/components/settings/gmail-connection-card";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const [status, { gmail }] = await Promise.all([
    getGmailConnectionStatus(),
    searchParams,
  ]);

  const notice = gmail === "connected" || gmail === "error" ? gmail : null;

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
        <GmailConnectionCard status={status} notice={notice} />
      </section>
    </div>
  );
}
