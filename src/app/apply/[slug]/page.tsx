import { loadApplyContext } from "@/lib/actions/apply";
import MatiousLogo from "@/components/matious-logo";
import ApplyForm from "./apply-form";
import BrandPanel from "./brand-panel";

export const dynamic = "force-dynamic";

function InfoCard({
  tone,
  title,
  message,
}: {
  tone: "error" | "muted";
  title: string;
  message: string;
}) {
  const iconWrap = tone === "error" ? "bg-red-50" : "bg-[#F1F5F9]";
  const iconColor = tone === "error" ? "text-red-600" : "text-[#64748B]";
  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
      <div className="flex min-h-screen flex-col px-6 sm:px-10">
        <header className="py-6">
          <MatiousLogo className="text-xl" />
        </header>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <div className={`w-12 h-12 rounded-full ${iconWrap} flex items-center justify-center mb-4`}>
              <svg className={`w-6 h-6 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3m0 3h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-[#111827] mb-2">{title}</h1>
            <p className="text-sm text-[#6B7280]">{message}</p>
          </div>
        </div>
      </div>
      <BrandPanel />
    </div>
  );
}

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let ctx;
  try {
    ctx = await loadApplyContext(slug);
  } catch (err) {
    return (
      <InfoCard
        tone="error"
        title="We couldn&apos;t open this link"
        message={err instanceof Error ? err.message : "Unable to load this opening."}
      />
    );
  }

  if (!ctx.is_accepting) {
    return (
      <InfoCard
        tone="muted"
        title="Applications are closed"
        message={`The opening for ${ctx.campaign_title} isn't accepting applications right now. Please check back later or contact the hiring team.`}
      />
    );
  }

  return <ApplyForm slug={slug} campaignTitle={ctx.campaign_title} />;
}
