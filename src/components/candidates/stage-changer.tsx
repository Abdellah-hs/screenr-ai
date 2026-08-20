"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { updateCandidateStage } from "@/lib/actions/candidates";
import {
  formatApplicationState as formatStateLabel,
  type ApplicationState,
} from "@/lib/constants";
import { recruiterStageOptions } from "@/lib/rules/manual-stage-change";
import {
  AnchoredMenu,
  MenuNote,
  MENU_ITEM,
  MENU_LABEL,
  Modal,
  ModalFooter,
  ModalHeader,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const FAILURE_STATES: ApplicationState[] = [
  "screening_expired",
  "interview_no_show",
  "processing_failed",
];

/** Chip colour by state category — negative outcomes red, hired green, idle grey, in-progress sky. */
function stateTone(state: ApplicationState): string {
  if (state === "hired") return "text-[#059669] bg-[#ECFDF5] border-[#A7F3D0]";
  if (state === "rejected" || FAILURE_STATES.includes(state)) {
    return "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]";
  }
  if (state === "new" || state === "archived") {
    return "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]";
  }
  return "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]";
}

export function StageChanger({
  applicationId,
  currentState,
  trigger = "chip",
  leadingItems,
}: {
  applicationId: string;
  currentState: ApplicationState;
  /**
   * `chip` — the state itself, clickable, for a detail page.
   * `menu` — a "…" row-actions button, for a table row where the state already
   *   has its own column and a second copy of it would be noise.
   */
  trigger?: "chip" | "menu";
  /** Rows rendered above the "Move to" group — a row menu is rarely only
   *  about the state machine. */
  leadingItems?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ApplicationState | null>(null);
  const [rationale, setRationale] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Only legal next-states a recruiter may actually set are offered: the state
  // machine's legal transitions minus system-produced states (screening_completed,
  // screening_scored, …) that reflect a candidate response or AI score. The
  // server (assertRecruiterSettableTarget + transitionApplication) enforces the
  // same rule as a backstop.
  const nextStates = recruiterStageOptions(currentState);
  const isTerminal = nextStates.length === 0;

  function pickTarget(state: ApplicationState) {
    setOpen(false);
    setError(null);
    setRationale("");
    setTarget(state);
  }

  function closeModal() {
    if (isPending) return; // don't let the modal close mid-save
    setTarget(null);
    setRationale("");
    setError(null);
  }

  function handleConfirm() {
    if (!target || rationale.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateCandidateStage(applicationId, target, rationale.trim());
        // Success — revalidatePath refreshes the page with the new state.
        setTarget(null);
        setRationale("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update stage");
      }
    });
  }

  return (
    <div className="relative">
      {trigger === "menu" ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Row actions"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[#9CA3AF] transition-colors duration-150 cursor-pointer hover:bg-[#F3F4F6] hover:text-[#4B5563] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      ) : (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !isTerminal && setOpen((o) => !o)}
        disabled={isTerminal}
        aria-haspopup={isTerminal ? undefined : "menu"}
        aria-expanded={isTerminal ? undefined : open}
        title={isTerminal ? "This is a terminal state — no further transitions" : "Change stage"}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium border rounded-md transition-colors duration-150",
          stateTone(currentState),
          isTerminal
            ? "cursor-default"
            : "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1",
        )}
      >
        {formatStateLabel(currentState)}
        {!isTerminal && (
          <svg
            className={cn("w-3 h-3 transition-transform duration-200", open && "rotate-180")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      )}

      {/* Portalled rather than absolutely positioned: this chip renders inside
          table cells and scroll regions, where an absolute menu is clipped by
          the first ancestor with an overflow. */}
      <AnchoredMenu
        open={open && (!isTerminal || Boolean(leadingItems))}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align={trigger === "menu" ? "right" : "left"}
      >
        {leadingItems && <div onClick={() => setOpen(false)}>{leadingItems}</div>}

        {!isTerminal && (
          <>
            <p className={MENU_LABEL}>Move to</p>
            {nextStates.map((state) => (
              <button
                key={state}
                type="button"
                role="menuitem"
                onClick={() => pickTarget(state)}
                className={MENU_ITEM}
              >
                {formatStateLabel(state)}
              </button>
            ))}
            <MenuNote>
              Every manual move asks for a written reason and lands in the
              transition log.
            </MenuNote>
          </>
        )}
      </AnchoredMenu>

      <Modal open={target !== null} onClose={closeModal}>
        {target && (
          <>
            <ModalHeader>
              <h2 className="text-lg font-semibold text-[#111827]">
                Change candidate stage
              </h2>
              <p className="mt-1 text-sm text-[#6B7280]">
                Moving from{" "}
                <span className="font-medium text-[#111827]">
                  {formatStateLabel(currentState)}
                </span>{" "}
                to{" "}
                <span className="font-medium text-[#111827]">
                  {formatStateLabel(target)}
                </span>
                .
              </p>
            </ModalHeader>

            <Textarea
              label="Reason for this change"
              placeholder="Why are you overriding the candidate's stage? This is recorded on the application's transition log."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={4}
              autoFocus
              disabled={isPending}
            />

            {error && <p className="mt-3 text-sm text-[#DC2626]">{error}</p>}

            <ModalFooter>
              <button
                type="button"
                onClick={closeModal}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium text-[#4B5563] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer transition-colors hover:bg-[#F9FAFB] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending || rationale.trim().length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-[#111827] rounded-lg cursor-pointer transition-colors hover:bg-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? "Saving…" : "Confirm change"}
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
