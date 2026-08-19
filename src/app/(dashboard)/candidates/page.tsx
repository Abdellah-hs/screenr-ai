import Link from "next/link";
import { getTalentPool } from "@/lib/actions/candidates";
import { getCuratedTalentPool } from "@/lib/actions/talent-pool";
import { TalentPoolTable } from "@/components/candidates/talent-pool-table";
import { CuratedPoolTable } from "@/components/candidates/curated-pool-table";
import { cn } from "@/lib/utils";

/**
 * Two lists that were previously one, and the split is the point of issue #141.
 *
 * "Talent pool" is the curated set from PRD 3.11 — people a recruiter
 * deliberately marked as worth revisiting. "All candidates" is the automatic
 * directory of everyone who ever applied, which is what this page used to show
 * under the talent-pool name. Both are useful; calling the directory a talent
 * pool was the inaccuracy.
 *
 * The curated view is the default even though it starts empty, because the page
 * is named after it and an empty state that explains how to fill it is more
 * honest than a directory wearing the wrong label.
 */
export default async function TalentPoolPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showDirectory = view === "all";

  const [entries, people] = await Promise.all([
    getCuratedTalentPool(),
    getTalentPool(),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#111827]">
          {showDirectory ? "All candidates" : "Talent pool"}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[#6B7280]">
          {showDirectory
            ? "Everyone who has applied to your campaigns, in one place. Each person shows where they came from — remove a campaign and its candidates still live here, with the removed campaign flagged so you can restore it."
            : "People you marked as worth revisiting, with your own tags and notes. Nobody lands here automatically; the pool is only what you put in it."}
        </p>
      </div>

      <div className="mb-6 inline-flex rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
        <ViewTab href="/candidates" label="Talent pool" count={entries.length} active={!showDirectory} />
        <ViewTab href="/candidates?view=all" label="All candidates" count={people.length} active={showDirectory} />
      </div>

      {showDirectory ? (
        <TalentPoolTable people={people} />
      ) : (
        <CuratedPoolTable entries={entries} />
      )}
    </div>
  );
}

function ViewTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
        active
          ? "bg-white text-[#111827] shadow-sm"
          : "text-[#6B7280] hover:text-[#111827]",
      )}
    >
      {label}
      <span className="text-[#9CA3AF]">{count}</span>
    </Link>
  );
}
