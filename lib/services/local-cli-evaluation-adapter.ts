import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assetAbsolutePath, getDataDir } from "@/lib/files/paths";
import { EvaluationAdapterError } from "@/lib/services/evaluation-adapter-error";
import type { EvaluationContext, ModelAdapter } from "@/lib/services/evaluation-adapters";

export type LocalCliProvider = "gemini" | "codex";

export interface LocalCliEvaluationAdapterOptions {
  provider: LocalCliProvider;
  modelName: string;
  timeoutMs: number;
  runner?: CliProcessRunner;
}

export interface CliRunRequest {
  provider: LocalCliProvider;
  command: string;
  args: string[];
  input: string;
  timeoutMs: number;
  cwd: string;
  shell: false;
}

export interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CliProcessRunner = (request: CliRunRequest) => Promise<CliRunResult>;

export interface EvaluationFiles {
  candidatePath: string;
  sourceAssetPaths: string[];
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "fit_score",
    "criteria",
    "ai_summary",
    "suggested_decision",
    "target_use_decision",
    "asset_quality_decision",
    "next_prompt_guidance",
    "confidence_state"
  ],
  properties: {
    fit_score: { type: "integer", minimum: 0, maximum: 100 },
    criteria: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "score", "reason"],
        properties: {
          criterion: {
            type: "string",
            enum: ["profile_fit", "source_asset_match", "prompt_intent_match", "production_usability"]
          },
          score: { type: "integer", minimum: 0, maximum: 100 },
          reason: { type: "string", minLength: 1 }
        }
      }
    },
    ai_summary: { type: "string", minLength: 1 },
    suggested_decision: { type: "string", enum: ["good", "needs_edit", "reject"] },
    target_use_decision: { type: "string", enum: ["good", "needs_edit", "reject"] },
    asset_quality_decision: { type: "string", enum: ["good", "needs_edit", "reject"] },
    next_prompt_guidance: { type: "string", minLength: 1 },
    confidence_state: { type: "string", enum: ["normal", "low_confidence"] }
  }
} as const;

const FORCE_KILL_GRACE_MS = 1_000;

export class LocalCliEvaluationAdapter implements ModelAdapter {
  private readonly runner: CliProcessRunner;

  constructor(private readonly options: LocalCliEvaluationAdapterOptions) {
    this.runner = options.runner || runCliProcess;
  }

  async evaluate(context: EvaluationContext): Promise<unknown> {
    const files = resolveEvaluationFiles(context, this.options.provider);
    const prompt = buildLocalCliPrompt(context, files, this.options.provider);
    const schemaPath = this.options.provider === "codex" ? writeTemporaryOutputSchema() : null;
    const request = buildLocalCliRunRequest({
      provider: this.options.provider,
      prompt,
      files,
      timeoutMs: this.options.timeoutMs,
      schemaPath
    });

    try {
      const result = await this.runner(request);
      const rawOutput = {
        provider: this.options.provider,
        model_name: this.options.modelName,
        command: request.command,
        args: request.args,
        exit_code: result.exitCode,
        timed_out: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr
      };

      if (result.timedOut) {
        throw new EvaluationAdapterError("Evaluation CLI timed out.", rawOutput);
      }
      if (result.exitCode !== 0) {
        throw new EvaluationAdapterError("Evaluation CLI failed.", rawOutput);
      }

      try {
        return parseLocalCliStdout(result.stdout);
      } catch (error) {
        throw new EvaluationAdapterError(error instanceof Error ? error.message : "Evaluation CLI returned invalid JSON.", rawOutput);
      }
    } finally {
      if (schemaPath) {
        rmSync(path.dirname(schemaPath), { recursive: true, force: true });
      }
    }
  }
}

export function buildLocalCliRunRequest(input: {
  provider: LocalCliProvider;
  prompt: string;
  files: EvaluationFiles;
  timeoutMs: number;
  schemaPath: string | null;
}): CliRunRequest {
  if (input.provider === "gemini") {
    return {
      provider: input.provider,
      command: "gemini",
      args: ["--prompt", input.prompt, "--output-format", "json", "--include-directories", getDataDir()],
      input: "",
      timeoutMs: input.timeoutMs,
      cwd: process.cwd(),
      shell: false
    };
  }

  const imageArgs = [input.files.candidatePath, ...input.files.sourceAssetPaths].flatMap((filePath) => [
    "--image",
    filePath
  ]);
  return {
    provider: input.provider,
    command: "codex",
    args: [
      "exec",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      ...(input.schemaPath ? ["--output-schema", input.schemaPath] : []),
      ...imageArgs,
      "-"
    ],
    input: input.prompt,
    timeoutMs: input.timeoutMs,
    cwd: process.cwd(),
    shell: false
  };
}

export function buildLocalCliPrompt(
  context: EvaluationContext,
  files: EvaluationFiles,
  provider: LocalCliProvider
): string {
  const imageReferences =
    provider === "gemini"
      ? [
          `Candidate image: @${files.candidatePath}`,
          ...files.sourceAssetPaths.map((sourcePath, index) => `Source asset ${index + 1}: @${sourcePath}`)
        ].join("\n")
      : [
          "Candidate image and source assets are attached with CLI image inputs.",
          `Candidate path for provenance: ${files.candidatePath}`,
          ...files.sourceAssetPaths.map((sourcePath, index) => `Source asset ${index + 1} path: ${sourcePath}`)
        ].join("\n");
  const metadata = {
    profile: {
      id: context.profile.id,
      name: context.profile.name,
      description: context.profile.description,
      style_summary: context.profile.style_summary
    },
    generation_context: {
      id: context.generationContext.id,
      name: context.generationContext.name,
      generation_goal: context.generationContext.generation_goal,
      asset_focus: context.generationContext.asset_focus,
      target_use: context.generationContext.target_use,
      source_prompt: context.generationContext.source_prompt
    },
    candidate: {
      id: context.candidate.id,
      prompt_text: context.candidate.prompt_text,
      prompt_missing: context.candidate.prompt_missing === 1,
      source_integrity: context.candidate.source_integrity,
      recovery_note: context.candidate.recovery_note
    },
    source_assets: context.sourceAssets.map((asset, index) => ({
      index: index + 1,
      id: asset.id,
      origin: asset.origin,
      asset_type: asset.asset_type,
      snapshot_note: asset.snapshot_note
    })),
    weak_reference_set: context.weakReferenceSet
  };
  const outputSkeleton = {
    fit_score: 84,
    criteria: [
      { criterion: "profile_fit", score: 84, reason: "One concrete reason." },
      { criterion: "source_asset_match", score: 82, reason: "One concrete reason." },
      { criterion: "prompt_intent_match", score: 85, reason: "One concrete reason." },
      { criterion: "production_usability", score: 80, reason: "One concrete reason." }
    ],
    ai_summary: "One concise summary.",
    suggested_decision: "good",
    target_use_decision: "good",
    asset_quality_decision: "good",
    next_prompt_guidance: "One actionable next prompt instruction.",
    confidence_state: "normal"
  };

  return [
    "You are evaluating one AI-generated game/ad asset against the actual generation context and source images.",
    "Return only a single JSON object. Do not wrap it in markdown. Do not include commentary.",
    "The JSON must contain fit_score, criteria, ai_summary, suggested_decision, target_use_decision, asset_quality_decision, next_prompt_guidance, and confidence_state.",
    "fit_score and every criteria score MUST be an integer from 0 to 100. Do not use 0..1 scores. Do not use 1..10 scores.",
    "criteria MUST be an array of exactly 4 objects. Do not return criteria as an object map. Do not return criteria as plain strings.",
    "Use exactly these four criteria: profile_fit, source_asset_match, prompt_intent_match, production_usability.",
    "Decision labels are good, needs_edit, or reject. Confidence states are normal or low_confidence.",
    "Separate target-use fit from asset quality. target_use_decision judges whether the candidate fits the current target_use and source prompt role. asset_quality_decision judges whether the candidate is satisfying enough to use somewhere in the product.",
    "A high-quality asset can still be target_use_decision=reject when it is the wrong asset role. For example, an endcard or ad composite can be asset_quality_decision=good but target_use_decision=reject for a reusable character cutout baseline.",
    "suggested_decision MUST exactly match target_use_decision for backward compatibility.",
    "Return JSON in exactly this shape, replacing the example values:",
    JSON.stringify(outputSkeleton, null, 2),
    imageReferences,
    "Context metadata:",
    JSON.stringify(metadata, null, 2)
  ].join("\n\n");
}

export function parseLocalCliStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Evaluation CLI returned empty JSON output.");
  }
  const parsed = JSON.parse(trimmed);
  return normalizeProviderOutput(unwrapProviderEnvelope(parsed));
}

export function normalizeProviderOutput(value: unknown): unknown {
  if (!isStringRecord(value)) {
    return value;
  }
  const normalized: Record<string, unknown> = { ...value };
  if (typeof normalized.fit_score === "number") {
    normalized.fit_score = normalizeScore(normalized.fit_score);
  }

  if (isStringRecord(normalized.criteria)) {
    const criteria = ["profile_fit", "source_asset_match", "prompt_intent_match", "production_usability"].map(
      (criterion) => {
        const rawCriterion = (normalized.criteria as Record<string, unknown>)[criterion];
        if (isStringRecord(rawCriterion) && typeof rawCriterion.score === "number" && typeof rawCriterion.reason === "string") {
          return {
            criterion,
            score: normalizeScore(rawCriterion.score),
            reason: rawCriterion.reason
          };
        }
        return null;
      }
    );
    if (criteria.every(Boolean)) {
      normalized.criteria = criteria;
    }
  }

  if (Array.isArray(normalized.criteria)) {
    normalized.criteria = normalized.criteria.map((criterion) => {
      if (!isStringRecord(criterion) || typeof criterion.score !== "number") {
        return criterion;
      }
      return {
        ...criterion,
        score: normalizeScore(criterion.score)
      };
    });
  }

  return normalized;
}

function unwrapProviderEnvelope(parsed: unknown): unknown {
  if (isStringRecord(parsed)) {
    const nested = parsed.response || parsed.text || parsed.output;
    if (typeof nested === "string" && nested.trim().startsWith("{")) {
      return JSON.parse(nested);
    }
  }
  return parsed;
}

function normalizeScore(score: number): number {
  if (score >= 0 && score <= 1) {
    return Math.round(score * 100);
  }
  if (score > 1 && score <= 10) {
    return Math.round(score * 10);
  }
  return Math.round(score);
}

function resolveEvaluationFiles(context: EvaluationContext, provider: LocalCliProvider): EvaluationFiles {
  const candidatePath = assetAbsolutePath(context.candidate.file_path);
  if (!existsSync(candidatePath)) {
    throw new EvaluationAdapterError("Candidate image file is missing.", {
      provider,
      missing_file: true,
      file_role: "candidate",
      file_path: context.candidate.file_path,
      absolute_path: candidatePath
    });
  }

  const sourceAssetPaths = context.sourceAssets.map((asset) => {
    const sourcePath = assetAbsolutePath(asset.file_path);
    if (!existsSync(sourcePath)) {
      throw new EvaluationAdapterError("Source asset file is missing.", {
        provider,
        missing_file: true,
        file_role: "source_asset",
        source_asset_id: asset.id,
        file_path: asset.file_path,
        absolute_path: sourcePath
      });
    }
    return sourcePath;
  });

  return { candidatePath, sourceAssetPaths };
}

function writeTemporaryOutputSchema(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "asset-evaluator-schema-"));
  const schemaPath = path.join(dir, `evaluation-output-${randomUUID()}.json`);
  writeFileSync(schemaPath, JSON.stringify(OUTPUT_SCHEMA, null, 2));
  return schemaPath;
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function runCliProcess(request: CliRunRequest): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: process.env,
      shell: request.shell,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let closed = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: CliRunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const requestChildTermination = () => {
      if (closed) {
        return;
      }
      child.kill("SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          if (!closed) {
            child.kill("SIGKILL");
          }
        }, FORCE_KILL_GRACE_MS);
        forceKillTimer.unref?.();
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      requestChildTermination();
      finish({ exitCode: null, stdout, stderr, timedOut: true });
    }, request.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (request.provider === "gemini" && canParseCompleteGeminiResult(stdout)) {
        requestChildTermination();
        finish({ exitCode: 0, stdout, stderr, timedOut: false });
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      reject(
        new EvaluationAdapterError("Evaluation CLI could not be started.", {
          provider: request.provider,
          command: request.command,
          args: request.args,
          error: error.message
        })
      );
    });
    child.on("close", (exitCode) => {
      closed = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      finish({ exitCode, stdout, stderr, timedOut });
    });

    child.stdin.end(request.input);
  });
}

function canParseCompleteGeminiResult(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed = parseLocalCliStdout(trimmed);
    return isStringRecord(parsed) && "fit_score" in parsed && "criteria" in parsed;
  } catch {
    return false;
  }
}
