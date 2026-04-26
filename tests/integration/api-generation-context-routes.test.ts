import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET as getProfileDetail } from "@/app/api/style-profiles/[id]/route";
import { GET as getProfileHistory } from "@/app/api/style-profiles/[id]/history/route";
import { POST as postGenerationContextCandidate } from "@/app/api/generation-contexts/[id]/candidates/route";
import { POST as postPromptRevision } from "@/app/api/generation-contexts/[id]/prompt-revisions/route";
import { getDb } from "@/lib/db/client";
import { GenerationContextService } from "@/lib/services/generation-context-service";
import { PromptRevisionService } from "@/lib/services/prompt-revision-service";
import { createImageFile, useTempDataDir } from "../helpers";

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("generation context API routes", () => {
  it("returns profile detail without legacy sessions", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };

    const response = await getProfileDetail(new Request(`http://test.local/api/style-profiles/${profile.id}`), params(profile.id));
    const data = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(data.generationContexts).toEqual(expect.arrayContaining([expect.objectContaining({ style_profile_id: profile.id })]));
    expect(data.generationContexts).toEqual(expect.arrayContaining([expect.objectContaining({ promptRevisions: expect.any(Array) })]));
    expect(data).not.toHaveProperty("sessions");
  });

  it("uploads candidates through generation context routes and returns history without legacy session objects", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("promptText", "Generate a polished character reaction pose.");

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(generationContext.id)
    );
    const uploadData = (await uploadResponse.json()) as {
      candidate: {
        generation_context_id: string;
        prompt_revision_id: string | null;
        sha256: string | null;
        byte_size: number | null;
        imageUrl: string | null;
        originalUrl: string | null;
      };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadData.candidate.generation_context_id).toBe(generationContext.id);
    expect(uploadData.candidate.prompt_revision_id).toBeTruthy();
    expect(uploadData.candidate.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(uploadData.candidate.byte_size).toBeGreaterThan(0);
    expect(uploadData.candidate.imageUrl).toMatch(/^\/api\/assets\//);
    expect(uploadData.candidate.originalUrl).toMatch(/^\/api\/assets\//);
    expect(
      db.prepare("SELECT prompt_text FROM prompt_revisions WHERE id = ?").get(uploadData.candidate.prompt_revision_id)
    ).toEqual({
      prompt_text: "Generate a polished character reaction pose."
    });

    const detailResponse = await getProfileDetail(new Request(`http://test.local/api/style-profiles/${profile.id}`), params(profile.id));
    const detailData = (await detailResponse.json()) as {
      generationContexts: Array<{ id: string; promptRevisions: Array<{ id: string; prompt_text: string }> }>;
      candidates: Array<{ id: string; prompt_revision_id: string | null; promptRevision: { id: string } | null }>;
    };

    expect(detailResponse.status).toBe(200);
    expect(detailData.generationContexts.find((context) => context.id === generationContext.id)?.promptRevisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: uploadData.candidate.prompt_revision_id,
          prompt_text: "Generate a polished character reaction pose."
        })
      ])
    );
    expect(detailData.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt_revision_id: uploadData.candidate.prompt_revision_id,
          promptRevision: expect.objectContaining({ id: uploadData.candidate.prompt_revision_id })
        })
      ])
    );

    const historyResponse = await getProfileHistory(
      new Request(`http://test.local/api/style-profiles/${profile.id}/history`),
      params(profile.id)
    );
    const historyData = (await historyResponse.json()) as {
      history: Array<Record<string, unknown> & { generationContext: { id: string } }>;
    };

    expect(historyResponse.status).toBe(200);
    expect(historyData.history).toHaveLength(1);
    expect(historyData.history[0].generationContext.id).toBe(generationContext.id);
    expect(historyData.history[0]).not.toHaveProperty("session");
  });

  it("attaches uploaded candidates to an existing prompt revision", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const revision = new PromptRevisionService().createRevision({
      generationContextId: generationContext.id,
      promptText: "existing revision prompt"
    });
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("promptRevisionId", revision.id);

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(generationContext.id)
    );
    const uploadData = (await uploadResponse.json()) as {
      candidate: {
        id: string;
        prompt_revision_id: string | null;
        prompt_text: string | null;
        prompt_missing: 0 | 1;
      };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadData.candidate.prompt_revision_id).toBe(revision.id);
    expect(uploadData.candidate.prompt_text).toBe("existing revision prompt");
    expect(uploadData.candidate.prompt_missing).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM prompt_revisions").get()).toEqual({ count: 1 });
  });

  it("creates child prompt revisions from candidate uploads", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const parent = new PromptRevisionService().createRevision({
      generationContextId: generationContext.id,
      revisionLabel: "root",
      promptText: "root revision prompt"
    });
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("parentPromptRevisionId", parent.id);
    formData.set("revisionLabel", "child");
    formData.set("revisionNote", "More readable pose.");
    formData.set("negativePrompt", "blur, extra fingers");
    formData.set("parametersJson", '{ "seed": 42, "steps": 24 }');
    formData.set("promptText", "child revision prompt");

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(generationContext.id)
    );
    const uploadData = (await uploadResponse.json()) as {
      candidate: {
        id: string;
        prompt_revision_id: string | null;
        prompt_text: string | null;
      };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadData.candidate.prompt_text).toBe("child revision prompt");
    expect(uploadData.candidate.prompt_revision_id).toBeTruthy();
    expect(
      db
        .prepare(
          `SELECT parent_prompt_revision_id, revision_label, revision_note, negative_prompt, parameters_json
           FROM prompt_revisions
           WHERE id = ?`
        )
        .get(uploadData.candidate.prompt_revision_id)
    ).toEqual({
      parent_prompt_revision_id: parent.id,
      revision_label: "child",
      revision_note: "More readable pose.",
      negative_prompt: "blur, extra fingers",
      parameters_json: '{"seed":42,"steps":24}'
    });
  });

  it("links uploaded prompt revisions to saved source guidance", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const guidanceId = insertPromptGuidance({
      profileId: profile.id,
      generationContextId: generationContext.id,
      candidateId: "source-guidance-candidate",
      guidanceText: "Keep the same character identity and simplify the pose silhouette.",
      evaluationState: "saved"
    });
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("promptText", "child revision from saved guidance");
    formData.set("sourceGuidanceId", guidanceId);

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(generationContext.id)
    );
    const uploadData = (await uploadResponse.json()) as {
      candidate: { id: string; prompt_revision_id: string | null };
    };

    expect(uploadResponse.status).toBe(201);
    expect(
      db.prepare("SELECT source_guidance_id FROM prompt_revisions WHERE id = ?").get(uploadData.candidate.prompt_revision_id)
    ).toEqual({ source_guidance_id: guidanceId });

    const detailResponse = await getProfileDetail(new Request(`http://test.local/api/style-profiles/${profile.id}`), params(profile.id));
    const detailData = (await detailResponse.json()) as {
      generationContexts: Array<{
        id: string;
        promptRevisions: Array<{ id: string; sourceGuidance: { id: string; guidance_text: string } | null }>;
      }>;
    };
    const revision = detailData.generationContexts
      .find((context) => context.id === generationContext.id)
      ?.promptRevisions.find((item) => item.id === uploadData.candidate.prompt_revision_id);
    expect(revision?.sourceGuidance).toEqual(
      expect.objectContaining({
        id: guidanceId,
        guidance_text: "Keep the same character identity and simplify the pose silhouette."
      })
    );

    const historyResponse = await getProfileHistory(
      new Request(`http://test.local/api/style-profiles/${profile.id}/history`),
      params(profile.id)
    );
    const historyData = (await historyResponse.json()) as {
      history: Array<{ evaluations: Array<{ prompt_guidance?: Array<{ id: string; evaluation_id: string; created_at: string }> }> }>;
    };
    expect(historyData.history.flatMap((item) => item.evaluations.flatMap((evaluation) => evaluation.prompt_guidance || []))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: guidanceId,
          evaluation_id: expect.any(String),
          created_at: expect.any(String)
        })
      ])
    );
  });

  it("rejects stale or cross-context prompt revisions before storing candidates", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const firstContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const secondContext = new GenerationContextService().createContext({
      styleProfileId: profile.id,
      name: "Second context"
    });
    const revision = new PromptRevisionService().createRevision({
      generationContextId: firstContext.id,
      promptText: "first context revision"
    });
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("promptRevisionId", revision.id);

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${secondContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(secondContext.id)
    );
    const errorData = (await uploadResponse.json()) as { error: string };

    expect(uploadResponse.status).toBe(400);
    expect(errorData.error).toMatch(/Prompt revision does not belong/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM candidate_images").get()).toEqual({ count: 0 });
  });

  it("rejects cross-context source guidance before storing candidates", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const firstContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const secondContext = new GenerationContextService().createContext({
      styleProfileId: profile.id,
      name: "Second context"
    });
    const guidanceId = insertPromptGuidance({
      profileId: profile.id,
      generationContextId: firstContext.id,
      candidateId: "source-guidance-cross-context",
      guidanceText: "Use a source from the first context only.",
      evaluationState: "saved"
    });
    const beforeCount = db.prepare("SELECT COUNT(*) AS count FROM candidate_images").get() as { count: number };
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("promptText", "new prompt in second context");
    formData.set("sourceGuidanceId", guidanceId);

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${secondContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(secondContext.id)
    );
    const errorData = (await uploadResponse.json()) as { error: string };

    expect(uploadResponse.status).toBe(400);
    expect(errorData.error).toMatch(/Source guidance does not belong to this generation context/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM candidate_images").get()).toEqual(beforeCount);
  });

  it("creates prompt revisions directly from saved source guidance", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const parent = new PromptRevisionService().createRevision({
      generationContextId: generationContext.id,
      revisionLabel: "root",
      promptText: "root prompt"
    });
    const guidanceId = insertPromptGuidance({
      profileId: profile.id,
      generationContextId: generationContext.id,
      candidateId: "direct-source-guidance",
      guidanceText: "Keep the same character and simplify the pose silhouette.",
      evaluationState: "saved"
    });

    const response = await postPromptRevision(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/prompt-revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptText: "Keep the same character and simplify the pose silhouette.",
          parentPromptRevisionId: parent.id,
          sourceGuidanceId: guidanceId,
          revisionLabel: "next revision",
          revisionNote: "Created from saved judgment guidance.",
          parametersJson: '{"seed": 7}'
        })
      }),
      params(generationContext.id)
    );
    const data = (await response.json()) as { promptRevision: { id: string } };

    expect(response.status).toBe(201);
    expect(
      db
        .prepare(
          `SELECT parent_prompt_revision_id, source_guidance_id, revision_label, revision_note, prompt_text, parameters_json
           FROM prompt_revisions
           WHERE id = ?`
        )
        .get(data.promptRevision.id)
    ).toEqual({
      parent_prompt_revision_id: parent.id,
      source_guidance_id: guidanceId,
      revision_label: "next revision",
      revision_note: "Created from saved judgment guidance.",
      prompt_text: "Keep the same character and simplify the pose silhouette.",
      parameters_json: '{"seed":7}'
    });
  });

  it("rejects invalid direct prompt revision requests", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };

    const invalidParametersResponse = await postPromptRevision(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/prompt-revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptText: "valid prompt",
          parametersJson: "[]"
        })
      }),
      params(generationContext.id)
    );
    expect(invalidParametersResponse.status).toBe(400);
    await expect(invalidParametersResponse.json()).resolves.toEqual({
      error: "Parameters JSON must be a plain object."
    });

    const missingGuidanceResponse = await postPromptRevision(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/prompt-revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptText: "valid prompt",
          sourceGuidanceId: "missing-guidance"
        })
      }),
      params(generationContext.id)
    );
    expect(missingGuidanceResponse.status).toBe(400);
    await expect(missingGuidanceResponse.json()).resolves.toEqual({
      error: "Source guidance not found."
    });
  });

  it("rejects direct prompt revisions from cross-context source guidance", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const firstContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const secondContext = new GenerationContextService().createContext({
      styleProfileId: profile.id,
      name: "Second context"
    });
    const guidanceId = insertPromptGuidance({
      profileId: profile.id,
      generationContextId: firstContext.id,
      candidateId: "direct-cross-context-guidance",
      guidanceText: "Use first-context source only.",
      evaluationState: "saved"
    });

    const response = await postPromptRevision(
      new Request(`http://test.local/api/generation-contexts/${secondContext.id}/prompt-revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptText: "new prompt in second context",
          sourceGuidanceId: guidanceId
        })
      }),
      params(secondContext.id)
    );
    const errorData = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(errorData.error).toMatch(/Source guidance does not belong to this generation context/);
  });

  it("stores prompt-missing candidate uploads without prompt revisions", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("promptMissing", "true");
    formData.set("recoveryNote", "Original prompt was not available.");

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(generationContext.id)
    );
    const uploadData = (await uploadResponse.json()) as {
      candidate: { prompt_revision_id: string | null; prompt_missing: 0 | 1; source_integrity: string };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadData.candidate).toMatchObject({
      prompt_revision_id: null,
      prompt_missing: 1,
      source_integrity: "incomplete"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM prompt_revisions").get()).toEqual({ count: 0 });

    const detailResponse = await getProfileDetail(new Request(`http://test.local/api/style-profiles/${profile.id}`), params(profile.id));
    const detailData = (await detailResponse.json()) as {
      generationContexts: Array<{ id: string; promptRevisions: Array<{ id: string }> }>;
      candidates: Array<{ id: string; promptRevision: { id: string } | null }>;
    };

    expect(detailResponse.status).toBe(200);
    expect(detailData.generationContexts.find((context) => context.id === generationContext.id)?.promptRevisions).toEqual([]);
    expect(detailData.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ promptRevision: null })]));
  });
});

function insertPromptGuidance(input: {
  profileId: string;
  generationContextId: string;
  candidateId: string;
  guidanceText: string;
  evaluationState: "draft" | "saved" | "failed";
}): string {
  const db = getDb();
  const evaluationId = randomUUID();
  const guidanceId = randomUUID();
  db.prepare(
    `INSERT INTO candidate_images
      (id, generation_context_id, file_path, prompt_text, prompt_missing, source_integrity)
     VALUES (?, ?, ?, 'source prompt', 0, 'complete')`
  ).run(input.candidateId, input.generationContextId, `assets/${input.candidateId}.png`);
  db.prepare(
    `INSERT INTO evaluations
      (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
     VALUES (?, ?, 'manual-judgment', 74, 'needs_edit', 'reason', NULL, NULL, 'normal', ?, 'v2_generation_context')`
  ).run(evaluationId, input.candidateId, input.evaluationState);
  db.prepare(
    `INSERT INTO prompt_guidance
      (id, style_profile_id, evaluation_id, guidance_text, confidence_state)
     VALUES (?, ?, ?, ?, 'normal')`
  ).run(guidanceId, input.profileId, evaluationId, input.guidanceText);
  return guidanceId;
}
