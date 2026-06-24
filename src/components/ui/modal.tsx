"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

function Modal({ open, onClose, children, className }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // `open` only flips true via client interaction, so SSR returns null here.
  if (!open || typeof document === "undefined") return null;

  // Portal to <body> so the modal isn't subject to an ancestor's inherited
  // styles (e.g. a table's `whitespace-nowrap`, which would stop the body text
  // wrapping) or `overflow` clipping. It's a fixed full-screen overlay, so its
  // position is unaffected by where it lives in the tree.
  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className={cn(
          "bg-card rounded-2xl p-8 shadow-xl max-w-[500px] w-full whitespace-normal animate-in fade-in zoom-in-95 duration-200",
          className
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface ModalHeaderProps {
  children: ReactNode;
  className?: string;
}

function ModalHeader({ children, className }: ModalHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      {children}
    </div>
  );
}

export interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div className={cn("flex items-center justify-end gap-3 mt-6", className)}>
      {children}
    </div>
  );
}

export { Modal, ModalHeader, ModalFooter };
