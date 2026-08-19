"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnchoredMenu } from "@/components/ui";
import {
  NotificationIcon,
  notificationCaption,
  notificationHref,
  notificationSummary,
} from "@/components/notification-item";
import type { RecruiterNotification } from "@/lib/data/notifications";

// Dismissed notifications persist per-device in localStorage as { [id]: count },
// where `count` is the count at dismiss time. A notification stays hidden across
// refreshes while its current count is <= the dismissed count, and re-surfaces
// once MORE candidates pile up (count exceeds the snapshot) — so dismissing can
// never permanently bury growing work.
const STORAGE_KEY = "screenr.dismissedNotifications";
const EMPTY: Record<string, number> = {};

function parse(raw: string | null): Record<string, number> {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, number>) : EMPTY;
  } catch {
    return EMPTY;
  }
}

// getSnapshot must return a stable reference when unchanged (useSyncExternalStore
// compares by Object.is), so cache the parsed value against the raw string.
let cachedRaw: string | null = null;
let cachedValue: Record<string, number> = EMPTY;

function getSnapshot(): Record<string, number> {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function getServerSnapshot(): Record<string, number> {
  return EMPTY;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function emit() {
  listeners.forEach((l) => l());
}

export function NotificationBell({
  notifications,
}: {
  notifications: RecruiterNotification[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const visible = notifications.filter((n) => (dismissed[n.id] ?? -1) < n.count);
  const total = visible.reduce((sum, n) => sum + n.count, 0);

  const dismiss = useCallback(
    (id: string, count: number) => {
      // Persist this dismissal and prune snapshots for notifications no longer
      // present, so a resolved-then-returning item starts fresh.
      const liveIds = new Set(notifications.map((n) => n.id));
      const current = parse(window.localStorage.getItem(STORAGE_KEY));
      const next: Record<string, number> = { [id]: count };
      for (const [k, v] of Object.entries(current)) {
        if (k !== id && liveIds.has(k)) next[k] = v;
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      emit();
    },
    [notifications],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={total > 0 ? `Notifications (${total})` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative text-[#6B7280] hover:text-[#111827] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-md"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {total > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-[#EF4444] border-2 border-white rounded-full">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="right"
        className="min-w-[300px] max-w-[360px] py-0 overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#E5E7EB]">
          <p className="text-sm font-semibold text-[#111827]">Notifications</p>
        </div>

        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-[#6B7280]">You&apos;re all caught up.</p>
            <p className="text-xs text-[#9CA3AF] mt-1">
              Pending reviews, SLA alerts, and expired interviews will show up here.
            </p>
          </div>
        ) : (
          <ul className="max-h-[360px] overflow-y-auto py-1">
            {visible.map((n) => (
              <li key={n.id}>
                <Link
                  href={notificationHref(n)}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    dismiss(n.id, n.count);
                  }}
                  className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:bg-[#F9FAFB]"
                >
                  <NotificationIcon notification={n} />
                  <span className="min-w-0">
                    <span className="block text-sm text-[#111827]">
                      <span className="font-medium">{n.campaignTitle}</span>
                      {notificationSummary(n)}
                    </span>
                    <span className="block text-xs text-[#6B7280] mt-0.5">
                      {notificationCaption(n)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AnchoredMenu>
    </>
  );
}

