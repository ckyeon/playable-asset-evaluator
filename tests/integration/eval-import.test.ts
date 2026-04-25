import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/lib/db/client";
import { EvalManifestImportError, EvalManifestImporter } from "@/lib/evals/import-manifest";
import { assetAbsolutePath, getAssetsDir, getDbPath } from "@/lib/files/paths";
import { ExportBuilder } from "@/lib/services/export-builder";
import { loadProfileContextReadModel } from "@/lib/services/profile-context-read-model";
import { useTempDataDir } from "../helpers";
import aiCharacterChatManifest from "../evals/ai-character-chat/manifest.json";
import matgoManifest from "../evals/matgo-slot/manifest.json";

const aiDatasetRoot = path.join(process.cwd(), "tests/evals/ai-character-chat");
const matgoDatasetRoot = path.join(process.cwd(), "tests/evals/matgo-slot");

describe("eval manifest import", () => {
  it("supports dry-run without DB or file side effects", async () => {
    useTempDataDir();

    const result = await new EvalManifestImporter().importDataset(aiDatasetRoot, { dryRun: true });

    expect(result.status).toBe("dry_run");
    expect(result.counts).toMatchObject({
      style_profiles: 1,
      reference_assets: 8,
      generation_contexts: 1,
      generation_context_assets: 8,
      prompt_revisions: 1,
      candidate_images: 10,
      evaluations: 10
    });
    expect(result.copied_files).toHaveLength(0);
    expect(existsSync(getDbPath())).toBe(false);
    expect(existsSync(getAssetsDir())).toBe(false);
  });

  it("rejects traversal, absolute, and missing-file manifests before staging", async () => {
    const traversalDataset = createDataset("traversal-dataset", {
      name: "Traversal dataset",
      status: "ready",
      asset_focus: "character",
      evaluation_goal: "style_match",
      contexts: [
        {
          id: "context-1",
          name: "Traversal context",
          generation_goal: "Traversal should fail.",
          source_assets: [
            {
              id: "source-1",
              asset_type: "character",
              image_path: "../escape.png",
              note: "This should be rejected."
            }
          ],
          candidates: [
            {
              id: "candidate-1",
              image_path: "assets/candidates/candidate-1.png",
              expected_decision: "good",
              human_reason: "placeholder reason for validation",
              prompt_missing: false
            }
          ]
        }
      ]
    });

    const absolutePathDataset = createDataset("absolute-path-dataset", {
      name: "Absolute path dataset",
      status: "ready",
      asset_focus: "character",
      evaluation_goal: "style_match",
      contexts: [
        {
          id: "context-1",
          name: "Absolute path context",
          generation_goal: "Absolute paths should fail.",
          source_assets: [
            {
              id: "source-1",
              asset_type: "character",
              image_path: path.join(tmpdir(), "outside-dataset.png"),
              note: "This should be rejected."
            }
          ],
          candidates: [
            {
              id: "candidate-1",
              image_path: "assets/candidates/candidate-1.png",
              expected_decision: "good",
              human_reason: "placeholder reason for validation",
              prompt_missing: false
            }
          ]
        }
      ]
    });

    const missingFileDataset = createDataset("missing-file-dataset", {
      name: "Missing file dataset",
      status: "ready",
      asset_focus: "character",
      evaluation_goal: "style_match",
      contexts: [
        {
          id: "context-1",
          name: "Missing file context",
          generation_goal: "Missing source should fail.",
          source_assets: [
            {
              id: "source-1",
              asset_type: "character",
              image_path: "assets/references/missing.png",
              note: "This file does not exist."
            }
          ],
          candidates: [
            {
              id: "candidate-1",
              image_path: "assets/candidates/candidate-1.png",
              expected_decision: "good",
              human_reason: "placeholder reason for validation",
              prompt_missing: false
            }
          ]
        }
      ]
    });

    try {
      writeFixtureAsset(
        traversalDataset,
        "assets/candidates/candidate-1.png",
        path.join(aiDatasetRoot, "assets/candidates/cand-01-nervous-clasped-hands.png")
      );
      await expect(new EvalManifestImporter().importDataset(traversalDataset, { dryRun: true })).rejects.toMatchObject({
        result: expect.objectContaining({
          status: "rejected",
          failed_item_path: "../escape.png",
          copied_files: []
        })
      });

      writeFixtureAsset(
        absolutePathDataset,
        "assets/candidates/candidate-1.png",
        path.join(aiDatasetRoot, "assets/candidates/cand-01-nervous-clasped-hands.png")
      );
      await expect(new EvalManifestImporter().importDataset(absolutePathDataset, { dryRun: true })).rejects.toMatchObject({
        result: expect.objectContaining({
          status: "rejected",
          failed_item_path: path.join(tmpdir(), "outside-dataset.png"),
          copied_files: []
        })
      });

      writeFixtureAsset(
        missingFileDataset,
        "assets/candidates/candidate-1.png",
        path.join(aiDatasetRoot, "assets/candidates/cand-01-nervous-clasped-hands.png")
      );
      await expect(new EvalManifestImporter().importDataset(missingFileDataset, { dryRun: true })).rejects.toMatchObject({
        result: expect.objectContaining({
          status: "rejected",
          failed_item_path: "assets/references/missing.png",
          copied_files: []
        })
      });
    } finally {
      rmSync(traversalDataset, { recursive: true, force: true });
      rmSync(absolutePathDataset, { recursive: true, force: true });
      rmSync(missingFileDataset, { recursive: true, force: true });
    }
  });

  it("imports prompt-missing candidates as low confidence with warnings", async () => {
    useTempDataDir();
    const dataset = createDataset("prompt-missing-dataset", {
      name: "Prompt missing dataset",
      status: "ready",
      asset_focus: "character",
      evaluation_goal: "style_match",
      contexts: [
        {
          id: "context-1",
          name: "Prompt missing context",
          generation_goal: "Import a candidate whose original prompt was not saved.",
          source_prompt: "Generate a matching character expression.",
          source_assets: [
            {
              id: "source-1",
              asset_type: "character",
              image_path: "assets/references/source-1.png",
              note: "Reference character pose and rendering style."
            }
          ],
          candidates: [
            {
              id: "candidate-1",
              image_path: "assets/candidates/candidate-1.png",
              expected_decision: "needs_edit",
              human_reason: "The character is usable but needs cleaner expression matching before production use.",
              prompt_missing: true
            }
          ]
        }
      ]
    });

    try {
      writeFixtureAsset(
        dataset,
        "assets/references/source-1.png",
        path.join(aiDatasetRoot, "assets/references/ref-01-couch-hand-cover.png")
      );
      writeFixtureAsset(
        dataset,
        "assets/candidates/candidate-1.png",
        path.join(aiDatasetRoot, "assets/candidates/cand-05-awkward-head-scratch.png")
      );

      const result = await new EvalManifestImporter().importDataset(dataset);

      expect(result.status).toBe("imported");
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "prompt_missing_low_confidence", item_id: "candidate-1" }),
          expect.objectContaining({ code: "missing_recovery_note", item_id: "candidate-1" })
        ])
      );

      const db = getDb();
      const candidate = db
        .prepare("SELECT prompt_text, prompt_missing, source_integrity, recovery_note FROM candidate_images")
        .get() as {
        prompt_text: string | null;
        prompt_missing: 0 | 1;
        source_integrity: string;
        recovery_note: string | null;
      };
      expect(candidate).toMatchObject({
        prompt_text: null,
        prompt_missing: 1,
        source_integrity: "incomplete",
        recovery_note: null
      });

      const evaluation = db.prepare("SELECT confidence_state, fit_score FROM evaluations").get() as {
        confidence_state: string;
        fit_score: number;
      };
      expect(evaluation).toMatchObject({
        confidence_state: "low_confidence",
        fit_score: 64
      });
    } finally {
      rmSync(dataset, { recursive: true, force: true });
    }
  });

  it("cleans staged files when commit fails after staging", async () => {
    useTempDataDir();
    const importer = new EvalManifestImporter({
      onBeforeCommit: () => {
        throw new Error("commit exploded");
      }
    });

    try {
      await importer.importDataset(aiDatasetRoot);
    } catch (error) {
      expect(error).toBeInstanceOf(EvalManifestImportError);
      const result = (error as EvalManifestImportError).result;
      expect(result.copied_files.length).toBeGreaterThan(0);
      expect(result.cleaned_files).toEqual(result.copied_files);
      for (const relativePath of result.cleaned_files) {
        expect(existsSync(assetAbsolutePath(relativePath))).toBe(false);
      }
      closeDbForTests();
      const db = getDb();
      const importedProfile = db
        .prepare("SELECT id FROM style_profiles WHERE name = ?")
        .get(aiCharacterChatManifest.name) as { id: string } | undefined;
      expect(importedProfile).toBeUndefined();
    }
  });

  it("imports the AI Character Chat dataset into profile, context, source assets, candidates, and saved evaluations", async () => {
    useTempDataDir();
    const result = await new EvalManifestImporter().importDataset(aiDatasetRoot);

    expect(result).toMatchObject({
      status: "imported",
      manifest_name: aiCharacterChatManifest.name,
      manifest_status: "ready",
      counts: {
        style_profiles: 1,
        reference_assets: 8,
        generation_contexts: 1,
        generation_context_assets: 8,
        prompt_revisions: 1,
        candidate_images: 10,
        evaluations: 10
      }
    });

    const db = getDb();
    const importedProfile = db
      .prepare("SELECT * FROM style_profiles WHERE name = ?")
      .get(aiCharacterChatManifest.name) as { id: string } | undefined;
    expect(importedProfile).toBeTruthy();

    const importedContext = db
      .prepare("SELECT * FROM generation_contexts WHERE style_profile_id = ? AND name = ?")
      .get(importedProfile?.id, aiCharacterChatManifest.contexts[0].name) as { id: string; source_prompt: string | null } | undefined;
    expect(importedContext).toBeTruthy();
    expect(importedContext?.source_prompt).toContain("캐릭터 이미지를 각 감정별로 생성해줘.");

    const referenceCount = db
      .prepare("SELECT COUNT(*) AS count FROM reference_assets WHERE style_profile_id = ?")
      .get(importedProfile?.id) as { count: number };
    expect(referenceCount.count).toBe(8);

    const contextSourceCount = db
      .prepare("SELECT COUNT(*) AS count FROM generation_context_assets WHERE generation_context_id = ?")
      .get(importedContext?.id) as { count: number };
    expect(contextSourceCount.count).toBe(8);

    const candidateCount = db
      .prepare("SELECT COUNT(*) AS count FROM candidate_images WHERE generation_context_id = ?")
      .get(importedContext?.id) as { count: number };
    expect(candidateCount.count).toBe(10);
    const promptRevisionCount = db
      .prepare("SELECT COUNT(*) AS count FROM prompt_revisions WHERE generation_context_id = ?")
      .get(importedContext?.id) as { count: number };
    expect(promptRevisionCount.count).toBe(1);
    const linkedCandidateCount = db
      .prepare("SELECT COUNT(*) AS count FROM candidate_images WHERE generation_context_id = ? AND prompt_revision_id IS NOT NULL")
      .get(importedContext?.id) as { count: number };
    expect(linkedCandidateCount.count).toBe(10);

    const evaluationCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM evaluations
         WHERE candidate_image_id IN (SELECT id FROM candidate_images WHERE generation_context_id = ?)
           AND evaluation_state = 'saved'
           AND rubric_version = 'v2_generation_context'`
      )
      .get(importedContext?.id) as { count: number };
    expect(evaluationCount.count).toBe(10);

    const exported = new ExportBuilder().buildJson(importedProfile!.id) as { contexts: Array<{ candidates: unknown[] }> };
    expect(exported.contexts).toHaveLength(1);
    expect(exported.contexts[0].candidates).toHaveLength(10);
    expect(new ExportBuilder().buildMarkdown(importedProfile!.id)).toContain("Generation Context: Emotion reaction batch");
  });

  it("imports explicit prompt revision chains and exposes expected effectiveness", async () => {
    useTempDataDir();
    const manifest = {
      name: "Prompt revision chain dataset",
      status: "ready",
      asset_focus: "character",
      evaluation_goal: "style_match",
      contexts: [
        {
          id: "context-1",
          name: "Revision chain context",
          generation_goal: "Import explicit prompt revisions.",
          source_prompt: "root prompt",
          prompt_revisions: [
            {
              id: "rev-root",
              revision_label: "root",
              prompt_text: "root prompt",
              expected_effectiveness: "unknown"
            },
            {
              id: "rev-improved",
              parent_prompt_revision_id: "rev-root",
              revision_label: "improved",
              prompt_text: "improved prompt",
              parameters_json: { seed: 12 },
              expected_effectiveness: "improved"
            },
            {
              id: "rev-flat",
              parent_prompt_revision_id: "rev-root",
              revision_label: "flat",
              prompt_text: "flat prompt",
              expected_effectiveness: "flat"
            },
            {
              id: "rev-regressed",
              parent_prompt_revision_id: "rev-root",
              revision_label: "regressed",
              prompt_text: "regressed prompt",
              expected_effectiveness: "regressed"
            },
            {
              id: "rev-unknown",
              parent_prompt_revision_id: "rev-root",
              revision_label: "unknown",
              prompt_text: "unknown prompt",
              expected_effectiveness: "unknown"
            }
          ],
          source_assets: [
            {
              id: "source-1",
              asset_type: "character",
              image_path: "assets/references/source-1.png",
              note: "Reference character pose and rendering style."
            }
          ],
          candidates: [
            {
              id: "candidate-root",
              image_path: "assets/candidates/candidate-root.png",
              expected_decision: "needs_edit",
              human_reason: "The root version is close but needs iteration.",
              prompt_missing: false,
              prompt_revision_id: "rev-root"
            },
            {
              id: "candidate-improved",
              image_path: "assets/candidates/candidate-improved.png",
              expected_decision: "good",
              human_reason: "This revision improves the character match enough for reuse.",
              prompt_missing: false,
              prompt_revision_id: "rev-improved"
            },
            {
              id: "candidate-flat",
              image_path: "assets/candidates/candidate-flat.png",
              expected_decision: "needs_edit",
              human_reason: "This revision is about as useful as the original.",
              prompt_missing: false,
              prompt_revision_id: "rev-flat"
            },
            {
              id: "candidate-regressed",
              image_path: "assets/candidates/candidate-regressed.png",
              expected_decision: "reject",
              human_reason: "This revision loses the source character identity.",
              prompt_missing: false,
              prompt_revision_id: "rev-regressed"
            }
          ]
        }
      ]
    };
    const dataset = createDataset("explicit-revision-dataset", manifest);

    try {
      writeFixtureAsset(
        dataset,
        "assets/references/source-1.png",
        path.join(aiDatasetRoot, "assets/references/ref-01-couch-hand-cover.png")
      );
      for (const candidate of manifest.contexts[0].candidates) {
        writeFixtureAsset(
          dataset,
          candidate.image_path,
          path.join(aiDatasetRoot, "assets/candidates/cand-01-nervous-clasped-hands.png")
        );
      }

      const result = await new EvalManifestImporter().importDataset(dataset);
      expect(result.counts.prompt_revisions).toBe(5);

      const db = getDb();
      const importedProfile = db
        .prepare("SELECT * FROM style_profiles WHERE name = ?")
        .get(manifest.name) as { id: string } | undefined;
      const model = loadProfileContextReadModel(importedProfile!.id);
      const revisions = new Map(model.contexts[0].promptRevisions.map((revision) => [revision.revision_label, revision]));
      for (const revision of manifest.contexts[0].prompt_revisions) {
        expect(revisions.get(revision.revision_label)?.effectiveness).toBe(revision.expected_effectiveness);
      }
      expect(revisions.get("improved")?.parameters_json).toBe('{"seed":12}');
      expect(model.contexts[0].candidates.find((item) => item.candidate.id)?.promptRevision).toBeTruthy();
    } finally {
      rmSync(dataset, { recursive: true, force: true });
    }
  });

  it("rejects bad prompt revision references before staging files", async () => {
    useTempDataDir();
    const unknownRevisionDataset = createDataset("unknown-revision-dataset", {
      name: "Unknown prompt revision dataset",
      status: "ready",
      asset_focus: "character",
      evaluation_goal: "style_match",
      contexts: [
        {
          id: "context-1",
          name: "Unknown revision context",
          generation_goal: "Reject unknown revision links.",
          source_assets: [
            {
              id: "source-1",
              asset_type: "character",
              image_path: "assets/references/source-1.png",
              note: "Reference character pose and rendering style."
            }
          ],
          candidates: [
            {
              id: "candidate-1",
              image_path: "assets/candidates/candidate-1.png",
              expected_decision: "good",
              human_reason: "placeholder reason for validation",
              prompt_missing: false,
              prompt_revision_id: "missing-revision"
            }
          ]
        }
      ]
    });
    const crossContextDataset = createDataset("cross-context-revision-dataset", {
      name: "Cross context prompt revision dataset",
      status: "ready",
      asset_focus: "character",
      evaluation_goal: "style_match",
      contexts: [
        {
          id: "context-1",
          name: "First context",
          generation_goal: "Owns the revision.",
          prompt_revisions: [{ id: "rev-a", prompt_text: "first prompt" }],
          source_assets: [
            {
              id: "source-1",
              asset_type: "character",
              image_path: "assets/references/source-1.png",
              note: "Reference character pose and rendering style."
            }
          ],
          candidates: [
            {
              id: "candidate-1",
              image_path: "assets/candidates/candidate-1.png",
              expected_decision: "good",
              human_reason: "placeholder reason for validation",
              prompt_missing: false,
              prompt_revision_id: "rev-a"
            }
          ]
        },
        {
          id: "context-2",
          name: "Second context",
          generation_goal: "Should not borrow the first revision.",
          source_assets: [
            {
              id: "source-2",
              asset_type: "character",
              image_path: "assets/references/source-2.png",
              note: "Reference character pose and rendering style."
            }
          ],
          candidates: [
            {
              id: "candidate-2",
              image_path: "assets/candidates/candidate-2.png",
              expected_decision: "good",
              human_reason: "placeholder reason for validation",
              prompt_missing: false,
              prompt_revision_id: "rev-a"
            }
          ]
        }
      ]
    });

    try {
      for (const dataset of [unknownRevisionDataset, crossContextDataset]) {
        writeFixtureAsset(
          dataset,
          "assets/references/source-1.png",
          path.join(aiDatasetRoot, "assets/references/ref-01-couch-hand-cover.png")
        );
        writeFixtureAsset(
          dataset,
          "assets/references/source-2.png",
          path.join(aiDatasetRoot, "assets/references/ref-02-blushing-portrait.png")
        );
        writeFixtureAsset(
          dataset,
          "assets/candidates/candidate-1.png",
          path.join(aiDatasetRoot, "assets/candidates/cand-01-nervous-clasped-hands.png")
        );
        writeFixtureAsset(
          dataset,
          "assets/candidates/candidate-2.png",
          path.join(aiDatasetRoot, "assets/candidates/cand-02-neutral-standing.png")
        );
      }

      await expect(new EvalManifestImporter().importDataset(unknownRevisionDataset)).rejects.toMatchObject({
        result: expect.objectContaining({ status: "rejected", copied_files: [] })
      });
      await expect(new EvalManifestImporter().importDataset(crossContextDataset)).rejects.toMatchObject({
        result: expect.objectContaining({ status: "rejected", copied_files: [] })
      });
    } finally {
      rmSync(unknownRevisionDataset, { recursive: true, force: true });
      rmSync(crossContextDataset, { recursive: true, force: true });
    }
  });

  it("allows dry-run for non-ready datasets but blocks actual import", async () => {
    useTempDataDir();
    const importer = new EvalManifestImporter();

    const dryRun = await importer.importDataset(matgoDatasetRoot, { dryRun: true });
    expect(dryRun.status).toBe("dry_run");
    expect(dryRun.warnings.some((warning) => warning.code === "non_ready_manifest")).toBe(true);

    await expect(importer.importDataset(matgoDatasetRoot)).rejects.toMatchObject({
      result: expect.objectContaining({
        status: "rejected",
        manifest_name: matgoManifest.name,
        manifest_status: "placeholder_assets_pending",
        copied_files: []
      })
    });

    closeDbForTests();
    const db = getDb();
    const importedProfile = db
      .prepare("SELECT id FROM style_profiles WHERE name = ?")
      .get(matgoManifest.name) as { id: string } | undefined;
    expect(importedProfile).toBeUndefined();
  });
});

function createDataset(prefix: string, manifest: object): string {
  const dir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  mkdirSync(path.join(dir, "assets", "references"), { recursive: true });
  mkdirSync(path.join(dir, "assets", "candidates"), { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

function writeFixtureAsset(datasetRoot: string, relativePath: string, sourcePath: string): void {
  const absolutePath = path.join(datasetRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  copyFileSync(sourcePath, absolutePath);
}
