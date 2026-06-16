export default function Navbar() {
  return (
    <header className="h-20 border-b border-[#E5E7EB] bg-[#FFFFFF] flex items-center justify-end px-8 z-10 sticky top-0">
      <button
        className="relative text-[#6B7280] hover:text-[#111827] transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-[#EF4444] border-2 border-white rounded-full"></span>
      </button>
    </header>
  );
}
