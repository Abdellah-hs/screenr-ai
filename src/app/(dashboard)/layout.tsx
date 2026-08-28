import Sidebar from "@/components/Sidebar";
import { getAuthUser } from "@/lib/auth/guards";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Shares the request-scoped memo with every action the page below calls, so
  // the shell does not buy its own copy of an answer the page already paid for.
  const user = await getAuthUser();

  return (
    // h-screen, not min-h-screen: the shell is exactly the viewport and <main>
    // is the only thing that scrolls, so the sidebar never travels.
    // `min-h-0` is what lets main shrink below its content and scroll at all —
    // without it a flex child is floored at its content height and the page
    // grows instead. A page can then claim `h-full` and fit itself.
    <div className="flex h-screen overflow-hidden bg-[#FAFAFA] text-[#111827]">
      <Sidebar email={user?.email ?? ""} />
      {/* No notification bar here: it is 80px of chrome for one icon, so the
          pages that want it render it themselves (the campaign board does). */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
  );
}
