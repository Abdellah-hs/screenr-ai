"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Campaigns", href: "/campaigns", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
  { label: "Settings", href: "/settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-[#E5E7EB] bg-[#F9FAFB] min-h-screen flex flex-col pt-6 z-10 shrink-0">
      <div className="px-6 mb-8 mt-2 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#2563EB] flex items-center justify-center text-white font-heading font-bold text-lg">S</div>
        <span className="font-heading font-semibold text-lg text-[#111827]">Screenr AI</span>
      </div>

      <nav className="flex-1 px-4 space-y-1">
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
      
      <div className="p-4 border-t border-[#E5E7EB]">
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
    </aside>
  );
}
