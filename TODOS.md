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

Context: `/plan-design-review` added minimal design tokens to the approved plan, but the repo has no `DESIGN.md` yet. Create it before building the production UI.

Depends on / blocked by: Approved design doc at `/Users/ckyeon/.gstack/projects/asset-evaluator/ckyeon-unknown-design-20260423-182116.md`.

## Evaluation

### Remove deprecated sessions API aliases

Status: Planned. Added by `/plan-ceo-review` for the Generation Context amendment.

What: Remove the deprecated `/api/sessions` and `/api/sessions/:id/candidates` aliases after the UI, tests, eval import script, and docs all use generation-context routes.

Why: The aliases are useful for one migration window, but keeping them indefinitely preserves two mental models for the same product unit.

Pros:
- Reduces API surface area after the migration settles.
- Prevents future validation drift between session and generation-context paths.
- Keeps `Generation Context` as the clear source of truth.

Cons:
- Requires checking all callers before removal.
- Can break any local scripts still using the old route names.

Context: `/plan-ceo-review` selected full migration from `evaluation_sessions` to `generation_contexts` with old session routes kept only as thin deprecated aliases. This TODO should be executed after implementation proves no app/test/import callers depend on old session routes.

Effort estimate: S human -> S with CC+gstack.

Priority: P2.

Depends on / blocked by: Generation Context implementation and route migration.

### Build Prompt Revision Chain

Status: Planned. Deferred by `/plan-ceo-review` until after Generation Context lands.

What: Track original prompt, follow-up prompt revisions, linked candidates, and whether generated guidance improved the next result.

Why: Generation Context records what was used for one generation attempt. Prompt Revision Chain records which edit instructions actually moved the output toward a better asset, which is needed for higher-quality recommendations.

Pros:
- Makes prompt guidance measurable instead of anecdotal.
- Helps recommend proven edit instructions for similar future contexts.
- Creates a bridge from judgment memory to semi-automated generation loops.

Cons:
- Adds DB/API/UI complexity beyond the core context migration.
- Needs enough saved contexts before the history becomes useful.

Context: The Generation Context amendment intentionally keeps only source prompt and next guidance in the current scope. This follow-up should add a prompt revision table, revision-to-candidate linkage, and guidance outcome tracking after the core context model is stable.

Effort estimate: M human -> S/M with CC+gstack.

Priority: P2.

Depends on / blocked by: Generation Context implementation.

### Build AI Character Chat character eval baseline

Status: Done. The ready dataset, copied eval images, and integrity test exist at `/Users/ckyeon/workspace/gigr/asset-evaluator/tests/evals/ai-character-chat/`.

What: Use AI Character Chat character assets as the first real v1 evaluator baseline: 8 reference images, 10 candidate images, expected `Good / Needs edit / Reject` labels, style tags, risk tags, and one-sentence human reasons.

Why: This gives the evaluator a concrete style-match baseline before live model integration, using the actual character-chat workflow the product should support next.

Next: Use this dataset as the first prompt/model regression gate when replacing the mock evaluator with a live multimodal adapter.

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
