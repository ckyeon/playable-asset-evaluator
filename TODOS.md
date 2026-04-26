# TODOs

## Design

### Create DESIGN.md before production UI implementation

Status: Done. See `/Users/ckyeon/workspace/gigr/asset-evaluator/DESIGN.md`.

What: Create a `DESIGN.md` that turns the approved design plan's minimal tokens into a reusable design source of truth.

Why: The app is a visual judgment tool. Without a design source of truth, implementation can drift into a generic dashboard and weaken trust in the evaluator.

Pros:
- Keeps typography, color, spacing, density, and component rules consistent.
- Gives `/design-html`, implementation, and later `/design-review` one shared reference.
- Prevents decorative AI-SaaS defaults from creeping into a production workspace.

Cons:
- Adds one more planning artifact before production UI implementation.
- Should be kept short enough that it guides implementation instead of becoming design theater.

Context: `/plan-design-review` added minimal design tokens to the approved plan. `DESIGN.md` now exists and is the source of truth for the production workspace UI.

Depends on / blocked by: Approved design doc at `/Users/ckyeon/.gstack/projects/asset-evaluator/ckyeon-unknown-design-20260423-182116.md`.

## Evaluation

### Add persistent evaluation job queue for hosted or batch mode

Status: Deferred by `/plan-eng-review`. The local CLI evaluator uses an in-memory per-candidate lock for the single-process local app.

What: Add a SQLite-backed evaluation job queue when Asset Evaluator supports hosted, multi-process, or batch evaluation.

Why: In-memory locks prevent duplicate local CLI calls in one Next.js process, but they do not protect multiple processes, hosted workers, or future batch agent runners.

Pros:
- Prevents duplicate paid/subscription-backed model calls across processes.
- Enables retry history, job status, and eventual background batch evaluation.
- Gives future Multi AI Agent evaluator workflows a clear scheduling boundary.

Cons:
- Adds schema, job states, polling UI, and migration work before local v1 needs it.
- Can distract from proving the local single-candidate evaluator loop first.

Context: The accepted local CLI evaluator plan keeps the app local-only and single-process, so `EVALUATION_ADAPTER=local-cli` is protected with an in-memory per-candidate lock. If `/workspace` later supports hosted deploys, batch evaluation, or multiple agent workers, move this lock into SQLite with explicit job states.

Effort: M.

Priority: P2.

Depends on / blocked by: Local CLI evaluator adapter proving useful; hosted or batch evaluator scope.

### Remove deprecated sessions API aliases

Status: Done. The deprecated HTTP routes and app response shapes now use only Generation Context APIs.

What: Remove the deprecated `/api/sessions` and `/api/sessions/:id/candidates` aliases after the UI, tests, eval import script, and docs all use generation-context routes.

Why: The aliases are useful for one migration window, but keeping them indefinitely preserves two mental models for the same product unit.

Pros:
- Reduces API surface area after the migration settles.
- Prevents future validation drift between session and generation-context paths.
- Keeps `Generation Context` as the clear source of truth.

Cons:
- Requires checking all callers before removal.
- Can break any local scripts still using the old route names.

Context: `/plan-ceo-review` selected full migration from `evaluation_sessions` to `generation_contexts` with old session routes kept only as thin deprecated aliases. The HTTP aliases and legacy SQLite compatibility have both been retired; modern local databases are cleaned up to use only `generation_contexts`.

Effort estimate: S human -> S with CC+gstack.

Priority: P2.

Depends on / blocked by: Generation Context implementation and route migration.

### Retire legacy evaluation_sessions DB compatibility

Status: Done. Fresh schemas, seed data, eval imports, and runtime services now use only `generation_contexts`.

What: Remove the legacy `evaluation_sessions` table, seed writes, and migration backfill path after a dedicated compatibility review.

Why: The product runtime now treats `generation_contexts` as the source of truth, but schema cleanup needs a safer migration boundary than the HTTP alias removal.

Context: Already-modern databases with a stale `evaluation_sessions` table drop it during startup after confirming `generation_contexts` and `candidate_images.generation_context_id` are present. Truly old v1 databases that still depend on `evaluation_sessions`/`candidate_images.session_id` now fail with a clear retired-schema message instead of being silently backfilled.

Priority: P2.

### Build Prompt Revision Chain

Status: Done. Prompt revisions are now first-class records linked to generation contexts and candidates.

What: Track original prompt, follow-up prompt revisions, linked candidates, and whether generated guidance improved the next result.

Why: Generation Context records what was used for one generation attempt. Prompt Revision Chain records which edit instructions actually moved the output toward a better asset, which is needed for higher-quality recommendations.

Pros:
- Makes prompt guidance measurable instead of anecdotal.
- Helps recommend proven edit instructions for similar future contexts.
- Creates a bridge from judgment memory to semi-automated generation loops.

Cons:
- Adds DB/API/UI complexity beyond the core context migration.
- Needs enough saved contexts before the history becomes useful.

Context: The implementation now includes the `prompt_revisions` table, root/child lineage, source guidance links, candidate linkage, parameter snapshots, effectiveness badges from saved evaluation deltas, eval manifest revision import support, export/read-model coverage, and a compact revision tree UI.

Effort estimate: M human -> S/M with CC+gstack.

Priority: P2.

Depends on / blocked by: None.

### Build reusable winning prompt snippets

Status: Deferred by `/plan-ceo-review`. Build after revision lineage and effectiveness badges have real saved outcomes.

What: Promote repeated successful prompt guidance into a style-profile-level snippet library that can be reused in future generation contexts.

Why: Once Prompt Revision Chain proves which guidance improves results, repeated winning edits should become reusable creative memory instead of staying buried in history.

Pros:
- Turns repeated successful prompt edits into a reusable asset.
- Gives future recommendation features grounded evidence instead of vibes.
- Helps users start the next generation attempt from proven guidance.

Cons:
- Weak before enough revision data exists.
- Can look smarter than it is if built before the app has real saved outcomes.

Context: The Prompt Revision Chain CEO review accepted first-class prompt revisions, parameter snapshots, revision forks, effectiveness badges, eval manifest revision support, and a compact revision tree UI. Snippet promotion should wait until those features produce enough saved outcomes to identify real repeated wins.

Effort estimate: M human -> S with CC+gstack.

Priority: P2.

Depends on / blocked by: Enough saved revision outcomes.

### Persist image hashes at upload/import time

Status: Done. `reference_assets`, `generation_context_assets`, and `candidate_images` now persist `sha256` and `byte_size` during upload/import, with a startup migration that backfills readable legacy files and leaves missing/unreadable files null.

What: Store image `sha256` and `byte_size` when assets are uploaded or imported.

Why: Large agent exports should not need to re-read every source and candidate image to prove file identity.

Pros:
- Makes export faster for large workspaces.
- Gives external agents stable image provenance without depending only on local file paths.
- Creates a safer foundation for portable datasets.

Cons:
- Requires a DB migration and backfill for existing local files.
- Touches upload, import, and migration paths.
- Adds storage fields before export usage proves the scale problem is real.

Context: The agent-ready single candidate review originally chose lazy export-time hashing. The persisted metadata path is now implemented: `ImageFileStore` computes metadata from the stored buffer, eval imports write the copied file metadata, profile-reference links copy stored metadata into context assets, and exports prefer persisted metadata while falling back to file reads for old/null rows. If a local file later goes missing, exports keep any stored hash/size as provenance and mark `missing_file`.

Effort: M.

Priority: P2.

Depends on: Agent-ready export contract.

### Track human-edited prompt guidance

Status: Done. `prompt_guidance` now stores `human_modified`, with a startup migration that defaults legacy guidance to `0`, save-time detection for edited/manual guidance, UI/API exposure, and agent export provenance.

What: Track whether saved prompt guidance was edited by a human before saving.

Why: Future agent training and evaluation may need to distinguish raw AI suggestions from human-corrected guidance.

Pros:
- Adds a useful trust signal to agent dataset items.
- Makes AI draft quality measurable against human edits.
- Improves provenance for future prompt-revision analysis.

Cons:
- Requires schema, API, UI, and migration work.
- Existing guidance records need a sensible default.
- Can distract from proving the first single-candidate dataset loop.

Context: Draft evaluator guidance is saved as `human_modified = 0` when unchanged. Edited draft guidance and manual guidance are saved as `human_modified = 1`, and unchanged resaves preserve the existing flag. Existing detail/history responses include the field through row spreading, and agent dataset exports expose it as a boolean on `next_prompt_guidance`.

Effort: M.

Priority: P2.

Depends on: Agent-ready export contract and direct create-next-revision flow.

### Build AI Character Chat character eval baseline

Status: Done. The ready dataset, copied eval images, integrity test, `eval:import` dogfood path, and split target-use/asset-quality labels exist at `/Users/ckyeon/workspace/gigr/asset-evaluator/tests/evals/ai-character-chat/`.

What: Use AI Character Chat character assets as the first real v1 evaluator baseline: 8 reference images, 10 candidate images, expected target-use `Good / Needs edit / Reject` labels, expected asset-quality labels, style tags, risk tags, and one-sentence human reasons.

Why: This gives the evaluator a concrete style-match baseline before live model integration, using the actual character-chat workflow the product should support next.

Next: Use this dataset as the first prompt/model regression gate for live multimodal adapters. Interpret target-use misses separately from asset-quality misses so high-quality assets in the wrong role are not treated as bad images.

Import check: `npm run eval:import -- tests/evals/ai-character-chat --dry-run` reports 1 style profile, 1 generation context, 8 source assets, 10 candidates, and 10 saved evaluations.

### Add failed AI Character Chat quality examples

Status: Deferred. The manifest schema now accepts future failed-asset intake fields, but the current AI Character Chat set is made of assets the user actually uses and likes.

What: Add rejected or needs-edit AI Character Chat images with `expected_quality_decision`, `quality_failure_reason`, `usable_alternative_context`, and `next_prompt_guidance`.

Why: The current baseline is good for target-use fit and role separation. Failed examples are needed to calibrate actual asset-quality failures instead of making the evaluator infer a quality floor from mostly successful assets.

Priority: P1.

Depends on / blocked by: User providing failed AI Character Chat assets and the reason each one was rejected.

### Build Matgo -> Slot tiny eval dataset

Status: Deferred. The placeholder manifest and validation test exist at `/Users/ckyeon/workspace/gigr/asset-evaluator/tests/evals/matgo-slot/`; AI Character Chat is now the first real ready baseline.

What: Create the v1 evaluator baseline dataset from the Matgo -> Slot playable asset session: 8 reference assets, 10 candidate images, expected decision labels, and one-sentence human reasons.

Why: The evaluator needs a baseline before implementation. Without this dataset, prompt/model changes will be judged by vibes instead of evidence.

Pros:
- Gives `/plan-eng-review` test requirements real data.
- Makes the tiny eval suite possible from day one.
- Prevents future prompt/model changes from silently making the evaluator worse.

Cons:
- Requires recovering the prior NanoBanana2 candidates or regenerating similar ones.
- Requires manually labeling each candidate before the app exists.

Context: The approved design doc and engineering review both rely on this dataset for `Good / Needs edit / Reject` expected decisions and prompt-missing behavior.

Depends on / blocked by: Access to the prior Matgo -> Slot playable reference assets and candidate images, or time to regenerate equivalent candidates.
