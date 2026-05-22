import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen bg-[#FAFAFA] text-[#111827]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar email={user?.email ?? ""} />
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
