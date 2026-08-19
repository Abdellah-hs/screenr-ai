"use client";

import { useState, useTransition } from "react";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui";
import { PoolCurationFields } from "./pool-curation-fields";
import {
  addToTalentPool,
  removeFromTalentPool,
  updateTalentPoolCuration,
  type CandidatePoolState,
} from "@/lib/actions/talent-pool";

/**
 * "Add to talent pool" on the candidate page — the primary way someone gets
 * into the curated pool (PRD 3.11.1).
 *
 * Deliberately available at every stage, not only after a rejection. The
 * rejection prompt catches the obvious case, but a recruiter forms the opinion
 * "keep this person in mind" while reading the evidence, which is here, and
 * making them wait for a rejection screen to record it loses the thought.
 */
export function TalentPoolButton({
  applicationId,
  candidateName,
  initialState,
  suggestions = [],
}: {
  applicationId: string;
  candidateName: string;
  initialState: CandidatePoolState;
  suggestions?: string[];
}) {
  const [state, setState] = useState(initialState);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          state.pooled
            ? "Edit the tags and note on this talent pool entry"
            : "Keep this candidate for a future role"
        }
        className={
          state.pooled
            ? "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-2 text-sm font-medium text-[#047857] transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1]"
            : "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] transition-colors hover:bg-[#F9FAFB] hover:text-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1]"
        }
      >
        <svg
          className="h-4 w-4"
          fill={state.pooled ? "currentColor" : "none"}
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.5a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
          />
        </svg>
        {state.pooled ? "In talent pool" : "Add to talent pool"}
      </button>

      {open && (
        <PoolEntryModal
          key={state.entryId ?? "new"}
          applicationId={applicationId}
          candidateName={candidateName}
          state={state}
          suggestions={suggestions}
          onClose={() => setOpen(false)}
          onSaved={setState}
        />
      )}
    </>
  );
}

const EMPTY: CandidatePoolState = { pooled: false, entryId: null, tags: [], notes: "" };

function PoolEntryModal({
  applicationId,
  candidateName,
  state,
  suggestions,
  onClose,
  onSaved,
}: {
  applicationId: string;
  candidateName: string;
  state: CandidatePoolState;
  suggestions: string[];
  onClose: () => void;
  onSaved: (next: CandidatePoolState) => void;
}) {
  const [tags, setTags] = useState<string[]>(state.tags);
  const [notes, setNotes] = useState(state.notes);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave() {
    setError(null);
    startTransition(async () => {
      try {
        if (state.pooled && state.entryId) {
          await updateTalentPoolCuration({ entryId: state.entryId, tags, notes });
          onSaved({ pooled: true, entryId: state.entryId, tags, notes });
        } else {
          const { entryId } = await addToTalentPool({ applicationId, tags, notes });
          onSaved({ pooled: true, entryId, tags, notes });
        }
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  function onRemove() {
    if (!state.entryId) return;
    setError(null);
    startTransition(async () => {
      try {
        await removeFromTalentPool(state.entryId as string);
        onSaved(EMPTY);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove");
      }
    });
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>
        <h2 className="text-lg font-semibold text-[#111827]">
          {state.pooled ? "Talent pool entry" : "Add to talent pool"}
        </h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          {state.pooled
            ? `${candidateName} is saved for future roles. Tags and notes are yours — they never reach the candidate.`
            : `Keep ${candidateName} for a future role. This changes nothing about their current application.`}
        </p>
      </ModalHeader>

      <PoolCurationFields
        tags={tags}
        notes={notes}
        onTagsChange={setTags}
        onNotesChange={setNotes}
        suggestions={suggestions}
        disabled={isPending}
      />

      {error && <p className="mt-3 text-sm text-[#DC2626]">{error}</p>}

      <ModalFooter>
        {state.pooled && (
          <button
            type="button"
            onClick={onRemove}
            disabled={isPending}
            className="mr-auto cursor-pointer rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#9CA3AF] transition-colors hover:border-[#FECACA] hover:bg-[#FEF2F2] hover:text-[#DC2626] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default"
          >
            Remove from pool
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="cursor-pointer rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#374151] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default disabled:bg-[#9CA3AF]"
        >
          {isPending ? "Saving…" : state.pooled ? "Save" : "Add to pool"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
