import Link from "next/link";
import { NotificationBell } from "@/components/notification-bell";
import { getCampaignBoard } from "@/lib/actions/campaigns";
import { getRecruiterNotifications } from "@/lib/actions/notifications";
import CampaignFilters from "./campaign-filters";

export default async function CampaignsPage() {
  const [{ campaigns, summaries, applyBlockers }, notifications] = await Promise.all([
    getCampaignBoard(),
    // Authed dashboard chrome — fail soft to an empty bell if the lookup hiccups.
    getRecruiterNotifications().catch(() => []),
  ]);

  return (
    // h-full so the board fits the viewport and the campaign table scrolls
    // inside its own box: the filters stay put however long the list gets,
    // and there is never a second, page-level scrollbar beside the first.
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
      {/* The bell lives in this row rather than in a band of its own. This is
          the one screen that carries it — it is where a recruiter starts, so
          it is where being told something is waiting actually helps — but an
          80px white strip holding a single icon reads as a second, emptier
          header above the one that already names the page. */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink">Campaigns</h1>

        <div className="flex items-center gap-3">
          <NotificationBell notifications={notifications} />
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 btn-primary"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New campaign
          </Link>
        </div>
      </div>

      <CampaignFilters
        campaigns={campaigns}
        summaries={summaries}
        applyBlockers={applyBlockers}
      />
    </div>
  );
}
