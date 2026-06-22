"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { disconnectGmail } from "@/lib/actions/integrations";
import type { GmailConnectionStatus } from "@/lib/data/integrations";

const CONNECT_URL = "/api/integrations/gmail/connect";

interface GmailConnectionCardProps {
  status: GmailConnectionStatus;
  notice: "connected" | "error" | null;
}

export function GmailConnectionCard({ status, notice }: GmailConnectionCardProps) {
  const router = useRouter();
  const [banner, setBanner] = useState(notice);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const dismissBanner = () => {
    setBanner(null);
    // Strip the ?gmail=... flag so a refresh doesn't resurface the banner.
    window.history.replaceState(null, "", "/settings");
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Disconnect this Gmail account? Resume sync will stop until you reconnect.")) {
      return;
    }
    try {
      setIsDisconnecting(true);
      await disconnectGmail();
      router.refresh();
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {banner === "connected" && (
        <Banner tone="success" onDismiss={dismissBanner}>
          Gmail connected. New resumes from this inbox will be picked up on sync.
        </Banner>
      )}
      {banner === "error" && (
        <Banner tone="error" onDismiss={dismissBanner}>
          We couldn&apos;t connect that Gmail account. Please try again.
        </Banner>
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FEE2E2] text-[#DC2626]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[#111827]">Gmail</h3>
              {status.connected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-medium text-[#15803D]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" aria-hidden="true" />
                  Connected
                </span>
              ) : status.needsReconnect ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF3C7] px-2.5 py-0.5 text-xs font-medium text-[#B45309]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" aria-hidden="true" />
                  Reconnect needed
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-[#F3F4F6] px-2.5 py-0.5 text-xs font-medium text-[#6B7280]">
                  Not connected
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#6B7280]">
              {status.connected ? (
                <>
                  Receiving resumes at{" "}
                  <span className="font-medium text-[#374151]">{status.email}</span>
                </>
              ) : status.needsReconnect ? (
                <>
                  We can&apos;t reach{" "}
                  <span className="font-medium text-[#374151]">{status.email}</span> — the
                  connection was revoked or expired. Reconnect to resume resume sync.
                </>
              ) : (
                "Connect the inbox where candidates send their CVs so resumes sync automatically."
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {status.connected ? (
            <>
              <a
                href={CONNECT_URL}
                className="inline-flex items-center justify-center rounded-lg border-2 border-[#D1D5DB] px-4 py-2 text-sm font-semibold text-[#374151] transition-colors duration-200 hover:bg-[#F9FAFB] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2"
              >
                Change account
              </a>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : status.needsReconnect ? (
            <>
              <a
                href={CONNECT_URL}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#1D4ED8] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
                Reconnect
              </a>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <a
              href={CONNECT_URL}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#1D4ED8] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Connect Gmail
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Banner({
  tone,
  onDismiss,
  children,
}: {
  tone: "success" | "error";
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const styles =
    tone === "success"
      ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]"
      : "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <span>{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 cursor-pointer opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
