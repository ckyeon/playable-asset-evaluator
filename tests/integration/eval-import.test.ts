import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/lib/db/client";
import { EvalManifestImportError, EvalManifestImporter } from "@/lib/evals/import-manifest";
import { assetAbsolutePath, getAssetsDir, getDbPath } from "@/lib/files/paths";
import { ExportBuilder } from "@/lib/services/export-builder";
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
