"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { initialsFromEmail } from "@/lib/utils";

const navItems = [
  { label: "Campaigns", href: "/campaigns", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
  { label: "Duplicates", href: "/admin/duplicates", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { label: "Settings", href: "/settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = initialsFromEmail(email);

  return (
    <aside className="w-64 border-r border-[#E5E7EB] bg-[#F9FAFB] h-screen sticky top-0 flex flex-col pt-6 z-10 shrink-0">
      <div className="px-6 mb-8 mt-2 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#2563EB] flex items-center justify-center text-white font-heading font-bold text-lg">S</div>
        <span className="font-heading font-semibold text-lg text-[#111827]">Screenr AI</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 space-y-1">
        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-4 px-3 mt-4">Main Menu</div>
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive
                  ? "bg-[#E0E7FF] text-[#1E40AF]"
                  : "text-[#4B5563] hover:text-[#111827] hover:bg-[#F3F4F6]"
              }`}
            >
              <svg
                className={`w-5 h-5 shrink-0 transition-colors ${isActive ? "text-[#2563EB]" : "text-[#6B7280] group-hover:text-[#4B5563]"}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={isActive ? 2.5 : 2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
      
      <div className="px-4 pb-2">
        <Link
          href="/support"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[#4B5563] hover:text-[#111827] hover:bg-[#F3F4F6] transition-colors"
        >
          <svg className="w-5 h-5 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          Support
        </Link>
      </div>

      {/* Signed-in user */}
      <div className="border-t border-[#E5E7EB] p-4">
        <div className="flex items-center gap-3" title={`Signed in as ${email}`}>
          <div className="w-9 h-9 shrink-0 rounded-full bg-[#111827] text-white flex items-center justify-center font-bold text-xs tracking-wider">
            {initials}
          </div>
          <p className="flex-1 min-w-0 truncate text-sm font-semibold text-[#111827]">
            {email}
          </p>
          <button
            onClick={handleSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="shrink-0 text-[#6B7280] hover:text-[#EF4444] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
