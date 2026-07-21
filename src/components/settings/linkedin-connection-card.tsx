"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { disconnectLinkedIn } from "@/lib/actions/integrations";
import type { SocialConnectionStatus } from "@/lib/data/integrations";

const CONNECT_URL = "/api/integrations/linkedin/connect";

interface LinkedInConnectionCardProps {
  status: SocialConnectionStatus;
  notice: "connected" | "error" | null;
}

export function LinkedInConnectionCard({ status, notice }: LinkedInConnectionCardProps) {
  const router = useRouter();
  const [banner, setBanner] = useState(notice);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const dismissBanner = () => {
    setBanner(null);
    window.history.replaceState(null, "", "/settings");
  };

  const confirmDisconnect = async () => {
    try {
      setIsDisconnecting(true);
      await disconnectLinkedIn();
      setShowDisconnectConfirm(false);
      router.refresh();
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {banner === "connected" && (
        <Banner tone="success" onDismiss={dismissBanner}>
          LinkedIn connected. You can publish &ldquo;we&rsquo;re hiring&rdquo; posts to your feed
          from a campaign&apos;s Share on social panel.
        </Banner>
      )}
      {banner === "error" && (
        <Banner tone="error" onDismiss={dismissBanner}>
          We couldn&apos;t connect that LinkedIn account. Please try again.
        </Banner>
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E0F2FE] text-[#0A66C2]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-[#111827]">LinkedIn</h3>
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
                  Publishing as{" "}
                  <span className="font-medium text-[#374151]">
                    {status.accountName ?? "your LinkedIn account"}
                  </span>
                </>
              ) : status.needsReconnect ? (
                "Your LinkedIn access expired. Reconnect to publish posts again."
              ) : (
                "Connect LinkedIn to publish “we’re hiring” posts to your feed from a campaign."
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
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <a
              href={CONNECT_URL}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0A66C2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#08509b] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0A66C2] focus:ring-offset-2"
            >
              {status.needsReconnect ? "Reconnect" : "Connect LinkedIn"}
            </a>
          )}
        </div>
      </div>

      <Modal
        open={showDisconnectConfirm}
        onClose={() => {
          if (!isDisconnecting) setShowDisconnectConfirm(false);
        }}
        className="max-w-[440px] p-6"
      >
        <ModalHeader>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#111827]">Disconnect LinkedIn?</h3>
            <p className="mt-1 text-sm text-[#6B7280]">
              You&apos;ll no longer be able to publish posts to LinkedIn until you reconnect.
              Posts you&apos;ve already published aren&apos;t affected.
            </p>
          </div>
        </ModalHeader>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowDisconnectConfirm(false)}
            disabled={isDisconnecting}
          >
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={confirmDisconnect} disabled={isDisconnecting}>
            {isDisconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </ModalFooter>
      </Modal>
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
