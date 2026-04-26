import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { assetAbsolutePath } from "@/lib/files/paths";
import { AssetStorage } from "@/lib/services/asset-storage";
import { GenerationContextService } from "@/lib/services/generation-context-service";
import { JudgmentStore } from "@/lib/services/judgment-store";
import { createImageFile, useTempDataDir } from "../helpers";

describe("generation context assets", () => {
  it("links profile references, stores context uploads, and deletes only context-owned files", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const context = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const storage = new AssetStorage();
    const service = new GenerationContextService();

    const reference = await storage.saveReferenceAsset({
      styleProfileId: profile.id,
      file: await createImageFile("reference.png"),
      assetType: "character",
      note: "same character reference"
    });
    const profileFilePath = reference.file_path;
    expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reference.byte_size).toBeGreaterThan(0);
    const linked = service.addProfileReference({
      generationContextId: context.id,
      referenceAssetId: reference.id
    });
    expect(linked.origin).toBe("profile_reference");
    expect(linked.sha256).toBe(reference.sha256);
    expect(linked.byte_size).toBe(reference.byte_size);

    const uploaded = await service.uploadContextSourceAsset({
      generationContextId: context.id,
      file: await createImageFile("source.png", "image/png", "#229977"),
      assetType: "character",
      note: "actual generation source"
    });
    expect(existsSync(assetAbsolutePath(uploaded.file_path))).toBe(true);
    expect(uploaded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(uploaded.byte_size).toBeGreaterThan(0);

    const candidate = await storage.saveCandidateImage({
      generationContextId: context.id,
      file: await createImageFile("candidate.png", "image/png", "#997722"),
      promptText: "same character, shy expression"
    });
    expect(candidate.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate.byte_size).toBeGreaterThan(0);
    new JudgmentStore().saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "good",
      humanReason: "This matches the source character and is production usable.",
      promptText: "same character, shy expression"
    });

    expect(service.getDeletePreview(context.id)).toMatchObject({
      candidate_count: 1,
      evaluation_count: 1,
      context_source_count: 1
    });

    await service.deleteContext(context.id);
    expect(existsSync(assetAbsolutePath(profileFilePath))).toBe(true);
    expect(existsSync(assetAbsolutePath(uploaded.file_path))).toBe(false);
    expect(existsSync(assetAbsolutePath(candidate.file_path))).toBe(false);
    expect(db.prepare("SELECT id FROM reference_assets WHERE id = ?").get(reference.id)).toBeTruthy();
  });
});
