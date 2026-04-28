# `src/lib/rules/` — Decision layer

Pure decision functions that read evidence and decide the next state-machine action. This layer exists because `Control > AI > Data` (CLAUDE.md): AI produces evidence, rules decide, actions orchestrate.

## What lives here

- "If score ≥ threshold and mode = auto, then `screening_approved`."
- "If response status is `scored` or `expired`, reject the load."
- "If required questions are unanswered, throw a candidate-facing error."

## Contract

A module in `src/lib/rules/`:

- **MUST NOT** import from `@/lib/supabase/*`.
- **MUST NOT** call `supabase.auth.*`, `revalidatePath`, `redirect`, or any other action-layer concern.
- **MUST NOT** import from `@/lib/actions/*` — not at runtime and not for types. If the rule needs a shape that currently lives in an action, move that shape into the rules module and have the action import it from here. The rule declares the contract it reads; producers conform.
- **SHOULD** be synchronous and pure. A rule whose decision *is* a state transition returns a `TransitionDescriptor` (`{ toState, rationale }`) and lets the caller execute `transitionApplication` / `advanceApplicationStatus`. Rules never mutate state themselves.
- **SHOULD** throw plain `Error` (or a single per-module subclass) rather than returning `Result`-like types.

## What doesn't live here

- **Zod validation.** Input shape validation happens in actions (`src/lib/validations.ts`). Rules receive already-validated data.
- **Auth / ownership.** Those belong in `src/lib/auth/guards.ts` and are called from actions.
- **Persistence.** Rules don't read or write Supabase. They decide; the caller persists.

## Testing

Colocated `foo.test.ts` with Vitest. Tests should be blazingly fast because there is no I/O and no mocks — rules are pure, so the test inputs and outputs are the whole story.
