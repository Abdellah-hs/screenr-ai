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
    <header className="h-20 border-b border-[#E5E7EB] bg-[#FFFFFF] flex items-center justify-between px-8 z-10 sticky top-0">
      {/* Left side: Search */}
      <div className="flex-1 max-w-xl">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input 
            type="text" 
            placeholder="Search candidates, internal jobs..." 
            className="w-full pl-10 pr-4 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Right side: Actions & Profile */}
      <div className="flex items-center gap-6">
        <button className="relative text-[#6B7280] hover:text-[#111827] transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="absolute 1 top-0 right-0 w-2.5 h-2.5 bg-[#EF4444] border-2 border-white rounded-full"></span>
        </button>

        <div className="w-px h-8 bg-[#E5E7EB]"></div>

        <div className="flex items-center gap-3 cursor-pointer group">
          <div className="w-10 h-10 rounded-full bg-[#111827] text-white flex flex-col items-center justify-center font-bold text-sm tracking-wider">
            JD
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-semibold text-[#111827] leading-tight">Jane Doe</p>
            <p className="text-xs text-[#6B7280]">Admin</p>
          </div>
          <svg className="w-4 h-4 text-[#6B7280] ml-1 group-hover:text-[#111827] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        <button
          onClick={handleSignOut}
          className="text-xs font-semibold text-[#6B7280] hover:text-[#EF4444] transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
