# `src/lib/rules/` — Decision layer

Pure(-ish) decision functions that read evidence and decide the next state-machine action. This layer exists because `Control > AI > Data` (CLAUDE.md): AI produces evidence, rules decide, actions orchestrate.

## What lives here

- "If score ≥ threshold and mode = auto, then `screening_approved`."
- "If response status is `scored` or `expired`, reject the load."
- "If required questions are unanswered, throw a candidate-facing error."

## Contract

A module in `src/lib/rules/`:

- **MUST NOT** import from `@/lib/supabase/*` directly.
- **MUST NOT** call `supabase.auth.*`, `revalidatePath`, `redirect`, or any other action-layer concern.
- **MUST NOT** import from `@/lib/actions/*` at runtime (type-only imports are acceptable during the transitional phase; Phase 6 of the decoupling refactor removes them).
- **SHOULD** be synchronous and pure. The one sanctioned exception: a rule whose decision *is* a state transition. Two styles coexist during the migration:
  - **Descriptor style** (preferred, after Phase 6): the rule returns `TransitionDescriptor` and the caller executes `transitionApplication`.
  - **Side-effecting style** (Phase 0 legacy): the rule calls `advanceApplicationStatus` internally. `resume-scoring.ts` is the only rule still in this style; Phase 6 converts it.
- **SHOULD** throw plain `Error` (or a single per-module subclass) rather than returning `Result`-like types.

## What doesn't live here

- **Zod validation.** Input shape validation happens in actions (`src/lib/validations.ts`). Rules receive already-validated data.
- **Auth / ownership.** Those belong in `src/lib/auth/guards.ts` and are called from actions.
- **Persistence.** Rules don't read or write Supabase. They decide; the caller persists.

## Testing

Colocated `foo.test.ts` with Vitest. Tests should be blazingly fast because there is no I/O. When a rule is in the side-effecting style (see Phase 0 exception above), mock the single data-layer collaborator and assert the arguments it was called with.
