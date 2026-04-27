import type {
  CandidateImage,
  GenerationContext,
  GenerationContextAsset,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";
import { EvaluationAdapterError } from "@/lib/services/evaluation-adapter-error";
import { LocalCliEvaluationAdapter, type LocalCliProvider } from "@/lib/services/local-cli-evaluation-adapter";
import { MockEvaluationAdapter } from "@/lib/services/mock-evaluation-adapter";

export interface EvaluationContext {
  profile: StyleProfile;
  generationContext: GenerationContext;
  candidate: CandidateImage;
  sourceAssets: GenerationContextAsset[];
  weakReferenceSet: boolean;
}

export interface ModelAdapter {
  evaluate(context: EvaluationContext): Promise<unknown>;
}

export interface EvaluationRunnerConfig {
  adapterName: "mock" | "local-cli";
  provider: LocalCliProvider;
  modelName: string;
  timeoutMs: number;
}

export { EvaluationAdapterError };

const DEFAULT_TIMEOUT_MS = 120_000;

type EvaluatorEnv = Record<string, string | undefined>;

export function createModelAdapterFromEnv(env: EvaluatorEnv = process.env): ModelAdapter {
  const config = resolveEvaluationRunnerConfig(env);
  if (config.adapterName === "mock") {
    return new MockEvaluationAdapter();
  }

  return new LocalCliEvaluationAdapter({
    provider: config.provider,
    modelName: config.modelName,
    timeoutMs: config.timeoutMs
  });
}

export function resolveEvaluationRunnerConfig(env: EvaluatorEnv = process.env): EvaluationRunnerConfig {
  const adapterName = resolveAdapterName(env.EVALUATION_ADAPTER);
  const provider = resolveProvider(env.EVALUATOR_PROVIDER);
  const modelName = resolveModelName(adapterName, provider, env);
  const timeoutMs = resolveTimeoutMs(env.EVALUATOR_TIMEOUT_MS);
  return { adapterName, provider, modelName, timeoutMs };
}

function resolveAdapterName(value: string | undefined): EvaluationRunnerConfig["adapterName"] {
  const normalized = value?.trim() || "local-cli";
  if (normalized === "mock" || normalized === "local-cli") {
    return normalized;
  }
  throw new Error("EVALUATION_ADAPTER must be 'mock' or 'local-cli'.");
}

function resolveProvider(value: string | undefined): LocalCliProvider {
  const normalized = value?.trim() || "gemini";
  if (normalized === "gemini" || normalized === "codex") {
    return normalized;
  }
  throw new Error("EVALUATOR_PROVIDER must be 'gemini' or 'codex'.");
}

function resolveModelName(
  adapterName: EvaluationRunnerConfig["adapterName"],
  provider: LocalCliProvider,
  env: EvaluatorEnv
): string {
  const configured = env.EVALUATOR_MODEL_NAME?.trim() || env.EVALUATION_MODEL?.trim();
  if (configured) {
    return configured;
  }
  if (adapterName === "mock") {
    return "mock-evaluator-v1";
  }
  return provider === "gemini" ? "gemini-cli" : "codex-cli";
}

function resolveTimeoutMs(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("EVALUATOR_TIMEOUT_MS must be a positive number.");
  }
  return Math.floor(parsed);
}

export function referenceToContextAsset(generationContextId: string) {
  return (reference: ReferenceAsset): GenerationContextAsset => ({
    id: reference.id,
    generation_context_id: generationContextId,
    reference_asset_id: reference.id,
    origin: "profile_reference",
    asset_type: reference.asset_type,
    file_path: reference.file_path,
    thumbnail_path: reference.thumbnail_path,
    sha256: reference.sha256,
    byte_size: reference.byte_size,
    snapshot_note: reference.note,
    created_at: reference.created_at
  });
}
