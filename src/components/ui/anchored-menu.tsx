"use client";

import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Coords = { top: number; left?: number; right?: number };

/**
 * One definition of a menu row, so a menu can't be small in one place and
 * comfortable in another. 13px over a 9px/10px box gives a ~35px row with the
 * icon, which is what the designs draw — the previous `px-3 py-1.5 text-xs`
 * was a 24px target you had to aim at.
 */
export const MENU_ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-left text-[13px] font-medium text-[#374151] cursor-pointer transition-colors duration-150 hover:bg-[#F3F4F6] hover:text-ink focus-visible:outline-none focus-visible:bg-[#F3F4F6] focus-visible:text-ink disabled:cursor-not-allowed disabled:opacity-50";

/** Destructive row. Heavier than its neighbours, and red rather than filled. */
export const MENU_ITEM_DANGER =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-left text-[13px] font-semibold text-[#B91C1C] cursor-pointer transition-colors duration-150 hover:bg-[#FEF2F2] focus-visible:outline-none focus-visible:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-50";

/** Section eyebrow above a group of rows. */
export const MENU_LABEL =
  "px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]";

/**
 * The consequence of the rows above it, in the menu rather than discovered
 * afterwards — every one of these menus can start something irreversible.
 */
export function MenuNote({ children }: { children: ReactNode }) {
  return (
    <p className="mx-2.5 mt-1.5 mb-1 text-[11px] leading-[1.45] text-[#9CA3AF]">
      {children}
    </p>
  );
}

/**
 * A dropdown menu rendered into a document-body portal and positioned (fixed)
 * relative to an anchor element. Because it's fixed + portalled, it escapes any
 * ancestor `overflow: hidden` / scroll clipping — which is exactly what a menu
 * triggered from inside a table card needs. Closes on outside click, scroll,
 * resize and Escape.
 */
export function AnchoredMenu({
  open,
  onClose,
  anchorRef,
  align = "left",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const [coords, setCoords] = useState<Coords | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const next: Coords = { top: r.bottom + 4 };
      if (align === "right") next.right = window.innerWidth - r.right;
      else next.left = r.left;
      setCoords(next);
    };
    place();

    // A scroll or resize would detach a fixed menu from its anchor — close it.
    const handleScroll = () => onClose();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, anchorRef, align, onClose]);

  // `open` only flips true via client interaction, so SSR always returns null
  // here; the document guard is belt-and-suspenders for the portal target.
  if (!open || !coords || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="menu"
        style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          right: coords.right,
        }}
        className={cn(
          "z-50 min-w-[232px] bg-white border border-[#E5E7EB] rounded-lg p-1 shadow-lg",
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
