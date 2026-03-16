"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function Navbar() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="h-16 border-b border-border bg-card flex items-center justify-between px-6">
      <Link href="/campaigns" className="text-lg font-bold text-foreground tracking-tight">
        Screenr AI
      </Link>

      <div className="flex items-center gap-4">
        <Link
          href="/campaigns"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          Campaigns
        </Link>
        <button
          onClick={handleSignOut}
          className="text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
