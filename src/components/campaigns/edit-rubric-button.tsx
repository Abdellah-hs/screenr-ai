"use client";

import { useState, useTransition } from "react";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { saveCampaignRubrics } from "@/lib/actions/campaigns";
import { unnamedRubricStages } from "@/lib/campaigns/wizard";
import type { EvaluationRubric } from "@/lib/constants";
import { EDITOR_HEAD_BUTTON } from "./editor-parts";
import { cn } from "@/lib/utils";
import RubricEditor, { seedRubrics } from "./rubric-editor";

interface EditRubricButtonProps {
  campaignId: string;
  /** The campaign's ACTIVE rubrics — archived versions must never be edited. */
  rubrics: EvaluationRubric[];
  /** What "Generate with AI" drafts from. Absent = the button explains itself. */
  description?: string;
}

/**
 * Edit a campaign's rubric where it is displayed.
 *
 * This used to be a link to `/campaigns/[id]/edit`, which opens the five-step
 * campaign wizard — the whole campaign, walked from the top, to rename one
 * criterion. Three things were wrong with that: the recruiter lost the page
 * they were reading the rubric on, the save posted every field of the campaign
 * back rather than the one they touched, and the rubric sat on step three of
 * five with no way to reach it directly.
 *
 * The wizard is still the right tool for creating a campaign and for a broad
 * edit. It is the wrong tool for a one-word change to a criterion.
 */
export default function EditRubricButton({
  campaignId,
  rubrics,
  description,
}: EditRubricButtonProps) {
  const [open, setOpen] = useState(false);
  // Controlled, so the draft lives here and Cancel is a real cancel — closing
  // without saving leaves the card showing what is actually stored.
  const [draft, setDraft] = useState<EvaluationRubric[]>(() =>
    seedRubrics(rubrics, campaignId),
  );
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    // Re-seed from the server's copy on every open: a previous cancel, or a
    // save made in another tab, must not leave a stale draft behind.
    setDraft(seedRubrics(rubrics, campaignId));
    setError(null);
    setOpen(true);
  }

  function handleSave() {
    setError(null);

    // The same rule the wizard blocks on, from the same function — this is the
    // only guard on the `saveCampaignRubrics` path, so it must not be able to
    // drift from the one the wizard applies.
    const unnamed = unnamedRubricStages(draft);
    if (unnamed.length > 0) {
      setError(
        `Name every dimension, or remove the empty rows — ${unnamed
          .map((s) => s.label)
          .join(", ")}.`,
      );
      return;
    }

    startSave(async () => {
      try {
        await saveCampaignRubrics(
          campaignId,
          // Only what the recruiter decides. `weight`, `min_score` and
          // `max_score` are derived server-side from these two, so sending the
          // editor's placeholders would be sending numbers nothing reads.
          draft.map((rubric) => ({
            stage: rubric.stage,
            dimensions: rubric.dimensions.map((d, i) => ({
              name: d.name.trim(),
              importance: d.importance,
              is_mandatory: d.is_mandatory,
              sort_order: i,
            })),
          })),
        );
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save the rubric");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={cn(EDITOR_HEAD_BUTTON, "shrink-0")}
      >
        Edit rubric
      </button>

      <Modal open={open} onClose={() => setOpen(false)} className="max-w-[820px]">
        <ModalHeader>
          <h3 className="text-lg font-semibold text-ink">Scoring rubric</h3>
          <p className="mt-1 text-sm leading-[1.55] text-[#6B7280]">
            One tab per stage. A stage you change is saved as a new version — the
            old one is archived, so scores already given keep meaning what they
            meant.
          </p>
        </ModalHeader>

        {/* The editor is three stages deep and the modal is a fixed box, so the
            body scrolls and the footer stays reachable. */}
        <div className="max-h-[58vh] overflow-y-auto pr-1">
          <RubricEditor
            campaignId={campaignId}
            value={draft}
            onChange={setDraft}
            description={description}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-3 text-[13px] leading-[1.55] text-[#B91C1C]"
          >
            {error}
          </p>
        )}

        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save rubric"}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
