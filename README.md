# Asset Evaluator

Asset Evaluator is a local workspace for recording creative judgment on AI-generated game and ad assets.

The core product unit is a **Generation Context**: the source asset set, source prompt, generation goal, candidates, evaluations, and saved human judgments for one generation batch.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000/workspace`, or the port printed by Next.js if `3000` is already in use.

## Eval Manifests

Eval fixtures live under `tests/evals/*/manifest.json` and use a `contexts[]` shape:

```text
style profile
  -> contexts[]
      -> source_assets[]
      -> candidates[]
      -> saved evaluations
```

Each ready manifest can be imported into the local SQLite workspace:

```bash
npm run eval:import -- tests/evals/ai-character-chat --dry-run
npm run eval:import -- tests/evals/ai-character-chat
```

Import policy:

- `status: "ready"` is required for actual import.
- Non-ready manifests are allowed for dry-run only.
- Manifest image paths must be relative to the dataset root.
- Absolute paths, path traversal, and missing files are rejected before staging.
- Files are copied before the DB transaction; staged files are cleaned up if commit fails.
- Candidates with `prompt_missing: true` are imported as `low_confidence`.
- Imported source and candidate images persist `sha256` and `byte_size` so exports do not need to re-read every
  image to prove file identity.

## Exports

Style profiles can be exported as JSON or Markdown through the workspace API:

```text
/api/style-profiles/:id/export.json
/api/style-profiles/:id/export.md
```

The JSON export includes `agent_dataset_items` for saved single-candidate evaluations. Source and candidate image
metadata prefer the persisted `sha256` and `byte_size` values written during upload or import, and fall back to file
reads only for older rows. If a local file goes missing later, the export marks `missing_file: true` while preserving
any stored hash and byte size for provenance.

## Verification

```bash
npm run typecheck
npm run eval:test
npm run test:integration
npm run test
```

The AI Character Chat baseline is the first ready dogfood dataset: 8 source assets, 10 candidates, and 10 saved judgments.

## Local CLI Evaluator

The app uses the mock evaluator by default. To opt into a local subscription-backed evaluator, log in to the CLI first, then start the app with:

```bash
EVALUATION_ADAPTER=local-cli EVALUATOR_PROVIDER=gemini npm run dev
```

Supported providers are `gemini` and `codex`. Live evaluator checks are explicit so normal tests never spend quota:

```bash
npm run eval:live -- --provider gemini
npm run eval:live -- --provider codex
```

`eval:live` runs with concurrency 5 and a 240s per-candidate timeout by default. Override with `--concurrency` or `--timeout-ms` when a local provider is slower or faster.

## Project Docs

- [DESIGN.md](DESIGN.md) defines the desktop workspace layout, visual tokens, and interaction states.
- [TODOS.md](TODOS.md) tracks deferred follow-up work such as hosted batch queues, reusable prompt snippets, and future eval dataset gaps.
