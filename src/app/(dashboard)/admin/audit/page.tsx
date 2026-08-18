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
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#111827]">
          Audit Log{" "}
          <span className="ml-2 font-normal text-[#6B7280]">({total})</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
          Every AI decision in the pipeline, with the model and prompt version that produced it and
          the raw output behind it. Append-only: rows can be read and exported, never edited or
          deleted.
        </p>
      </div>

      <AuditLogTable initialEntries={entries} initialTotal={total} campaigns={campaigns} />
    </div>
  );
}
