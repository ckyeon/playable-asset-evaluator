import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import type { GenerationContext, PromptGuidance, PromptRevision } from "@/lib/types/domain";

const TEXT_CAPS = {
  promptText: 8000,
  negativePrompt: 4000,
  revisionNote: 1000,
  revisionLabel: 120,
  parametersJsonBytes: 8192
};

interface CreateRevisionInput {
  generationContextId: string;
  parentPromptRevisionId?: string | null;
  sourceGuidanceId?: string | null;
  revisionLabel?: string | null;
  revisionNote?: string | null;
  promptText?: string | null;
  negativePrompt?: string | null;
  parametersJson?: string | null;
}

interface ResolveCandidateUploadInput extends CreateRevisionInput {
  promptRevisionId?: string | null;
  promptMissing?: boolean;
}

export interface ResolvedPromptRevision {
  promptRevisionId: string | null;
  promptText: string | null;
}

export class PromptRevisionService {
  createRevision(input: CreateRevisionInput): PromptRevision {
    const db = getDb();
    this.getContext(input.generationContextId);
    const promptText = requiredCapped(input.promptText, "Prompt text", TEXT_CAPS.promptText);
    const parentPromptRevisionId = nullableTrim(input.parentPromptRevisionId);
    const sourceGuidanceId = nullableTrim(input.sourceGuidanceId);
    const revisionLabel = optionalCapped(input.revisionLabel, "Revision label", TEXT_CAPS.revisionLabel);
    const revisionNote = optionalCapped(input.revisionNote, "Revision note", TEXT_CAPS.revisionNote);
    const negativePrompt = optionalCapped(input.negativePrompt, "Negative prompt", TEXT_CAPS.negativePrompt);
    const parametersJson = normalizeParametersJson(input.parametersJson);

    if (parentPromptRevisionId) {
      this.getRevisionForContext(parentPromptRevisionId, input.generationContextId, "Parent prompt revision");
    }
    if (sourceGuidanceId) {
      this.getGuidanceForContext(sourceGuidanceId, input.generationContextId);
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO prompt_revisions
        (id, generation_context_id, parent_prompt_revision_id, source_guidance_id, revision_label, revision_note, prompt_text, negative_prompt, parameters_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.generationContextId,
      parentPromptRevisionId,
      sourceGuidanceId,
      revisionLabel,
      revisionNote,
      promptText,
      negativePrompt,
      parametersJson
    );

    return db.prepare("SELECT * FROM prompt_revisions WHERE id = ?").get(id) as PromptRevision;
  }

  resolveForCandidateUpload(input: ResolveCandidateUploadInput): ResolvedPromptRevision {
    this.getContext(input.generationContextId);
    const promptRevisionId = nullableTrim(input.promptRevisionId);
    if (promptRevisionId) {
      const revision = this.getRevisionForContext(promptRevisionId, input.generationContextId, "Prompt revision");
      return {
        promptRevisionId: revision.id,
        promptText: revision.prompt_text
      };
    }

    const promptText = nullableTrim(input.promptText);
    if (!promptText) {
      if (input.promptMissing) {
        return { promptRevisionId: null, promptText: null };
      }
      throw new Error("Prompt text is required to create a prompt revision.");
    }

    const revision = this.createRevision({
      generationContextId: input.generationContextId,
      parentPromptRevisionId: input.parentPromptRevisionId,
      sourceGuidanceId: input.sourceGuidanceId,
      revisionLabel: input.revisionLabel,
      revisionNote: input.revisionNote,
      promptText,
      negativePrompt: input.negativePrompt,
      parametersJson: input.parametersJson
    });

    return {
      promptRevisionId: revision.id,
      promptText: revision.prompt_text
    };
  }

  private getContext(generationContextId: string): GenerationContext {
    const db = getDb();
    const context = db
      .prepare("SELECT * FROM generation_contexts WHERE id = ?")
      .get(generationContextId) as GenerationContext | undefined;
    if (!context) {
      throw new Error("Generation context not found.");
    }
    return context;
  }

  private getRevisionForContext(id: string, generationContextId: string, label: string): PromptRevision {
    const db = getDb();
    const revision = db.prepare("SELECT * FROM prompt_revisions WHERE id = ?").get(id) as PromptRevision | undefined;
    if (!revision) {
      throw new Error(`${label} not found.`);
    }
    if (revision.generation_context_id !== generationContextId) {
      throw new Error(`${label} does not belong to this generation context.`);
    }
    return revision;
  }

  private getGuidanceForContext(sourceGuidanceId: string, generationContextId: string): PromptGuidance {
    const db = getDb();
    const context = this.getContext(generationContextId);
    const guidance = db.prepare("SELECT * FROM prompt_guidance WHERE id = ?").get(sourceGuidanceId) as
      | PromptGuidance
      | undefined;
    if (!guidance) {
      throw new Error("Source guidance not found.");
    }
    if (guidance.style_profile_id !== context.style_profile_id) {
      throw new Error("Source guidance does not belong to this style profile.");
    }

    if (guidance.evaluation_id) {
      const linked = db
        .prepare(
          `SELECT candidate_images.generation_context_id
           FROM evaluations
           JOIN candidate_images ON candidate_images.id = evaluations.candidate_image_id
           WHERE evaluations.id = ?`
        )
        .get(guidance.evaluation_id) as { generation_context_id: string } | undefined;
      if (!linked || linked.generation_context_id !== generationContextId) {
        throw new Error("Source guidance does not belong to this generation context.");
      }
    }

    return guidance;
  }
}

function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function requiredCapped(value: string | null | undefined, label: string, maxLength: number): string {
  const trimmed = nullableTrim(value);
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function optionalCapped(value: string | null | undefined, label: string, maxLength: number): string | null {
  const trimmed = nullableTrim(value);
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function normalizeParametersJson(value: string | null | undefined): string | null {
  const trimmed = nullableTrim(value);
  if (!trimmed) {
    return null;
  }
  if (Buffer.byteLength(trimmed, "utf8") > TEXT_CAPS.parametersJsonBytes) {
    throw new Error("Parameters JSON must be 8KB or smaller.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Parameters JSON must be valid JSON.");
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Parameters JSON must be a plain object.");
  }

  const canonical = JSON.stringify(parsed);
  if (Buffer.byteLength(canonical, "utf8") > TEXT_CAPS.parametersJsonBytes) {
    throw new Error("Parameters JSON must be 8KB or smaller.");
  }
  return canonical;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}
