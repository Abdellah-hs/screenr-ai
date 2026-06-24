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
          "z-50 min-w-[180px] bg-white border border-[#E5E7EB] rounded-lg py-1 shadow-lg",
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
