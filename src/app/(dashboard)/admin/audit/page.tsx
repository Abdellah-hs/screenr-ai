import { requireUserId } from "@/lib/auth/guards";
import { fetchAuditCampaignOptions, fetchAuditLog } from "@/lib/data/audit-log";
import { AUDIT_PAGE_SIZE } from "@/lib/constants";
import { AuditLogTable } from "@/components/admin/audit-log-table";

/**
 * Audit Log (PRD 3.7.3) — the read side of the AI decision trail.
 *
 * Every AI call in the pipeline persists its raw output, model, prompt version,
 * rubric version, confidence and rationale. This is where that evidence becomes
 * inspectable and exportable, which is what the EU AI Act's high-risk
 * classification for recruitment AI actually requires.
 */
export default async function AuditLogPage() {
  const userId = await requireUserId();

  const [{ entries, total }, campaigns] = await Promise.all([
    fetchAuditLog(userId, {}, 0, AUDIT_PAGE_SIZE),
    fetchAuditCampaignOptions(userId),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      {/* No count beside the title. The table carries a live one that tracks
          the filters, and a second figure up here would disagree with it the
          moment anybody narrowed the trail. */}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">Audit Log</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#6B7280]">
          Every AI decision in the pipeline, with the model and prompt version that produced it
          and the raw output behind it.
        </p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs text-[#4B5563]">
          <svg
            className="h-3.5 w-3.5 shrink-0 text-[#6B7280]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
          <span>
            <strong className="font-semibold text-ink">Append-only.</strong> Rows can be read and
            exported, never edited or deleted.
          </span>
        </p>
      </header>

      <AuditLogTable initialEntries={entries} initialTotal={total} campaigns={campaigns} />
    </div>
  );
}
