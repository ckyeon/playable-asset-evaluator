"use client";

import {
  Clipboard,
  Copy,
  Download,
  FileImage,
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DecisionLabel = "good" | "needs_edit" | "reject";
type ConfidenceState = "normal" | "low_confidence";

interface StyleProfile {
  id: string;
  name: string;
  description: string | null;
  style_summary: string | null;
  updated_at: string;
}

interface ReferenceAsset {
  id: string;
  asset_type: string;
  file_path: string;
  thumbnail_path: string | null;
  note: string | null;
  imageUrl: string | null;
}

interface Session {
  id: string;
  name: string;
}

interface GenerationContext {
  id: string;
  style_profile_id: string;
  name: string;
  generation_goal: string | null;
  asset_focus: string;
  target_use: string | null;
  source_prompt: string | null;
  tool_name: string | null;
  model_name: string | null;
  updated_at: string;
  reference_strength: "none" | "weak" | "strong";
  confidence_reasons: string[];
  candidate_count: number;
  saved_judgment_count: number;
  sourceAssets: ContextSourceAsset[];
}

interface ContextSourceAsset {
  id: string;
  generation_context_id: string;
  reference_asset_id: string | null;
  origin: "profile_reference" | "context_upload";
  asset_type: string;
  file_path: string;
  thumbnail_path: string | null;
  snapshot_note: string | null;
  imageUrl: string | null;
}

interface Candidate {
  id: string;
  generation_context_id: string;
  file_path: string;
  thumbnail_path: string | null;
  prompt_text: string | null;
  prompt_missing: 0 | 1;
  recovery_note: string | null;
  source_integrity: "complete" | "incomplete";
  imageUrl: string | null;
  originalUrl: string | null;
}

interface Criterion {
  criterion: string;
  score: number;
  reason: string;
}

interface Evaluation {
  id: string;
  fit_score: number;
  decision_label: DecisionLabel;
  human_reason: string | null;
  ai_summary: string | null;
  confidence_state: ConfidenceState;
  evaluation_state: "draft" | "saved" | "failed";
  criteria?: Criterion[];
  prompt_guidance?: Array<{ guidance_text: string }>;
}

interface ProfileDetail {
  profile: StyleProfile;
  referenceAssets: ReferenceAsset[];
  generationContexts: GenerationContext[];
  sessions: Session[];
  candidates: Candidate[];
}

interface Draft {
  evaluation: Evaluation;
  criteria: Criterion[];
  next_prompt_guidance: string;
  weak_reference_set: boolean;
}

interface HistoryItem {
  session: Session;
  generationContext?: GenerationContext;
  candidate: Candidate;
  evaluations: Evaluation[];
}

const assetTypes = [
  ["card", "Card"],
  ["coin_reward", "Coin / reward"],
  ["button_cta", "Button / CTA"],
  ["background_effect", "Background / effect"],
  ["character", "Character"],
  ["other", "Other"]
];

export function WorkspaceClient() {
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const candidateInputRef = useRef<HTMLInputElement | null>(null);
  const [profiles, setProfiles] = useState<StyleProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const [currentCandidate, setCurrentCandidate] = useState<Candidate | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [newContextName, setNewContextName] = useState("");
  const [generationGoal, setGenerationGoal] = useState("");
  const [referenceType, setReferenceType] = useState("card");
  const [referenceNote, setReferenceNote] = useState("");
  const [sourceType, setSourceType] = useState("character");
  const [sourceNote, setSourceNote] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptMissing, setPromptMissing] = useState(false);
  const [recoveryNote, setRecoveryNote] = useState("");
  const [generationTool, setGenerationTool] = useState("NanoBanana2");
  const [decisionLabel, setDecisionLabel] = useState<DecisionLabel>("needs_edit");
  const [humanReason, setHumanReason] = useState("");
  const [guidanceText, setGuidanceText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);

  const activeContext = useMemo(() => {
    if (!detail?.generationContexts.length) {
      return null;
    }
    return detail.generationContexts.find((context) => context.id === selectedContextId) || detail.generationContexts[0];
  }, [detail, selectedContextId]);

  const activeContextCandidates = useMemo(
    () => detail?.candidates.filter((candidate) => candidate.generation_context_id === activeContext?.id) || [],
    [activeContext?.id, detail?.candidates]
  );

  const loadProfiles = useCallback(async () => {
    const response = await fetch("/api/style-profiles", { cache: "no-store" });
    const data = (await response.json()) as { profiles: StyleProfile[] };
    setProfiles(data.profiles);
    setSelectedProfileId((current) => current || data.profiles[0]?.id || null);
  }, []);

  const loadDetail = useCallback(async (profileId: string) => {
    const [detailResponse, historyResponse] = await Promise.all([
      fetch(`/api/style-profiles/${profileId}`, { cache: "no-store" }),
      fetch(`/api/style-profiles/${profileId}/history`, { cache: "no-store" })
    ]);
    const detailData = (await detailResponse.json()) as ProfileDetail;
    const historyData = (await historyResponse.json()) as { history: HistoryItem[] };
    setDetail(detailData);
    setHistory(historyData.history);
    const nextContext =
      detailData.generationContexts.find((context) => context.id === selectedContextId) ||
      detailData.generationContexts[0] ||
      null;
    setSelectedContextId(nextContext?.id || null);
    const nextCandidate = nextContext
      ? detailData.candidates.find((candidate) => candidate.generation_context_id === nextContext.id)
      : detailData.candidates[0];
    if (!currentCandidate && nextCandidate) {
      selectCandidate(nextCandidate);
    }
  }, [currentCandidate, selectedContextId]);

  useEffect(() => {
    loadProfiles().catch((error) => setStatus({ kind: "error", text: error.message }));
  }, [loadProfiles]);

  useEffect(() => {
    if (selectedProfileId) {
      loadDetail(selectedProfileId).catch((error) => setStatus({ kind: "error", text: error.message }));
    }
  }, [loadDetail, selectedProfileId]);

  useEffect(() => {
    if (!activeContext) {
      return;
    }
    if (!currentCandidate || currentCandidate.generation_context_id !== activeContext.id) {
      const nextCandidate = activeContextCandidates[0] || null;
      if (nextCandidate) {
        selectCandidate(nextCandidate);
      }
    }
  }, [activeContext, activeContextCandidates, currentCandidate]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (file) {
        event.preventDefault();
        uploadCandidate(file).catch((error) => setStatus({ kind: "error", text: error.message }));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const savedEvaluations = useMemo(
    () => history.flatMap((item) => item.evaluations.filter((evaluation) => evaluation.evaluation_state === "saved")),
    [history]
  );

  function selectCandidate(candidate: Candidate) {
    setCurrentCandidate(candidate);
    setPromptText(candidate.prompt_text || "");
    setPromptMissing(candidate.prompt_missing === 1 || !candidate.prompt_text);
    setRecoveryNote(candidate.recovery_note || "");
    setDraft(null);
    const latest = history
      .find((item) => item.candidate.id === candidate.id)
      ?.evaluations.find((evaluation) => evaluation.evaluation_state !== "failed");
    if (latest) {
      setDecisionLabel(latest.decision_label);
      setHumanReason(latest.human_reason || "");
      setGuidanceText(latest.prompt_guidance?.[0]?.guidance_text || "");
    } else {
      setDecisionLabel("needs_edit");
      setHumanReason("");
      setGuidanceText("");
    }
  }

  async function createProfile() {
    if (!newProfileName.trim()) {
      return;
    }
    setBusy("profile");
    try {
      const response = await fetch("/api/style-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newProfileName })
      });
      if (!response.ok) {
        throw new Error((await response.json()).error);
      }
      const data = (await response.json()) as { profile: StyleProfile };
      setNewProfileName("");
      setSelectedProfileId(data.profile.id);
      await loadProfiles();
      setStatus({ kind: "ok", text: "Style profile created." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to create profile." });
    } finally {
      setBusy(null);
    }
  }

  async function createContext() {
    if (!selectedProfileId || !newContextName.trim()) {
      return;
    }
    setBusy("context");
    try {
      const response = await fetch(`/api/style-profiles/${selectedProfileId}/generation-contexts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newContextName,
          generationGoal,
          assetFocus: sourceType,
          sourcePrompt: promptText,
          toolName: generationTool
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      setNewContextName("");
      setGenerationGoal("");
      setSelectedContextId(data.generationContext.id);
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Generation context created." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to create context." });
    } finally {
      setBusy(null);
    }
  }

  async function uploadReferences(files: FileList | null) {
    if (!files || !selectedProfileId) {
      return;
    }
    setBusy("reference");
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("assetType", referenceType);
        formData.append("note", referenceNote);
        const response = await fetch(`/api/style-profiles/${selectedProfileId}/reference-assets`, {
          method: "POST",
          body: formData
        });
        if (!response.ok) {
          throw new Error((await response.json()).error);
        }
      }
      setReferenceNote("");
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Reference asset saved." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to upload reference." });
    } finally {
      setBusy(null);
      if (referenceInputRef.current) {
        referenceInputRef.current.value = "";
      }
    }
  }

  async function addProfileReferenceToContext(referenceAssetId: string) {
    if (!selectedProfileId || !activeContext) {
      return;
    }
    setBusy(`source-add-${referenceAssetId}`);
    try {
      const response = await fetch(`/api/generation-contexts/${activeContext.id}/source-assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referenceAssetId })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Source asset added to context." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to add source asset." });
    } finally {
      setBusy(null);
    }
  }

  async function uploadContextSources(files: FileList | null) {
    if (!files || !selectedProfileId || !activeContext) {
      return;
    }
    setBusy("source-upload");
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("assetType", sourceType);
        formData.append("note", sourceNote);
        const response = await fetch(`/api/generation-contexts/${activeContext.id}/source-assets`, {
          method: "POST",
          body: formData
        });
        if (!response.ok) {
          throw new Error((await response.json()).error);
        }
      }
      setSourceNote("");
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Context source asset saved." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to upload source asset." });
    } finally {
      setBusy(null);
      if (sourceInputRef.current) {
        sourceInputRef.current.value = "";
      }
    }
  }

  async function uploadCandidate(file: File) {
    if (!selectedProfileId || !activeContext) {
      throw new Error("Create or select a generation context first.");
    }
    setBusy("candidate");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("promptText", promptText);
      formData.append("promptMissing", String(promptMissing || !promptText.trim()));
      formData.append("recoveryNote", recoveryNote);
      formData.append("generationTool", generationTool);

      const response = await fetch(`/api/generation-contexts/${activeContext.id}/candidates`, {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }

      selectCandidate(data.candidate);
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Candidate image saved." });
    } finally {
      setBusy(null);
      if (candidateInputRef.current) {
        candidateInputRef.current.value = "";
      }
    }
  }

  async function evaluateCandidate() {
    if (!currentCandidate) {
      return;
    }
    setBusy("evaluate");
    try {
      const response = await fetch(`/api/candidates/${currentCandidate.id}/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      setDraft(data.draft);
      setDecisionLabel(data.draft.evaluation.decision_label);
      setGuidanceText(data.draft.next_prompt_guidance);
      setStatus({
        kind: "ok",
        text: data.draft.weak_reference_set
          ? "Draft evaluation saved with weak reference set warning."
          : "Draft evaluation saved."
      });
      if (selectedProfileId) {
        await loadDetail(selectedProfileId);
      }
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Evaluation failed." });
    } finally {
      setBusy(null);
    }
  }

  async function saveJudgment() {
    if (!currentCandidate) {
      return;
    }
    setBusy("save");
    try {
      const response = await fetch(`/api/candidates/${currentCandidate.id}/save-judgment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decisionLabel,
          humanReason,
          promptText,
          promptMissing,
          recoveryNote,
          generationTool,
          nextPromptGuidance: guidanceText
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      setStatus({ kind: "ok", text: "Judgment saved to creative memory." });
      if (selectedProfileId) {
        await loadDetail(selectedProfileId);
      }
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to save judgment." });
    } finally {
      setBusy(null);
    }
  }

  async function copyGuidance() {
    if (!guidanceText.trim()) {
      return;
    }
    await navigator.clipboard.writeText(guidanceText);
    setStatus({ kind: "ok", text: "Prompt guidance copied." });
  }

  async function deleteReferenceAsset(referenceAssetId: string) {
    if (!selectedProfileId || !window.confirm("Remove this reference asset?")) {
      return;
    }

    setBusy(`reference-delete-${referenceAssetId}`);
    try {
      const response = await fetch(`/api/reference-assets/${referenceAssetId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Reference asset removed." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to remove reference." });
    } finally {
      setBusy(null);
    }
  }

  async function deleteCurrentCandidate() {
    if (!currentCandidate || !selectedProfileId || !window.confirm("Remove this candidate image and its evaluations?")) {
      return;
    }

    setBusy("candidate-delete");
    try {
      const response = await fetch(`/api/candidates/${currentCandidate.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      setCurrentCandidate(null);
      setDraft(null);
      setPromptText("");
      setPromptMissing(false);
      setRecoveryNote("");
      setDecisionLabel("needs_edit");
      setHumanReason("");
      setGuidanceText("");
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Candidate image removed." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to remove candidate." });
    } finally {
      setBusy(null);
    }
  }

  const activeEvaluation = draft?.evaluation;
  const activeCriteria = draft?.criteria || [];

  return (
    <main className="workspace">
      <div className="desktop-blocker">
        <div className="desktop-blocker__box">
          <h1>Desktop workspace required</h1>
          <p>Asset Evaluator v1 needs at least 1024px width for side-by-side visual judgment.</p>
        </div>
      </div>

      <div className="workspace-shell">
        <aside className="sidebar">
          <div className="brand-row">
            <h1>Asset Evaluator</h1>
            <FileImage size={18} aria-hidden />
          </div>

          <div className="profile-list" aria-label="Style profiles">
            {profiles.map((profile) => (
              <button
                className={`profile-button ${profile.id === selectedProfileId ? "is-active" : ""}`}
                key={profile.id}
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setSelectedContextId(null);
                  setCurrentCandidate(null);
                }}
              >
                <strong>{profile.name}</strong>
                <span>{profile.description || "Reusable visual judgment memory"}</span>
              </button>
            ))}
          </div>

          <div className="create-profile">
            <label className="section-title" htmlFor="profile-name">
              New profile
            </label>
            <input
              id="profile-name"
              className="input"
              value={newProfileName}
              onChange={(event) => setNewProfileName(event.target.value)}
              placeholder="Puzzle reward bright casual"
            />
            <button className="button secondary" onClick={createProfile} disabled={busy === "profile"}>
              <Save size={16} aria-hidden /> Create
            </button>
          </div>

          {detail ? (
            <div className="create-profile" style={{ marginTop: 18 }}>
              <label className="section-title">Generation contexts</label>
              <div className="profile-list" aria-label="Generation contexts">
                {detail.generationContexts.map((context) => (
                  <button
                    className={`profile-button ${context.id === activeContext?.id ? "is-active" : ""}`}
                    key={context.id}
                    onClick={() => {
                      setSelectedContextId(context.id);
                      setCurrentCandidate(null);
                    }}
                  >
                    <strong>{context.name}</strong>
                    <span>
                      {context.reference_strength} · {context.candidate_count} candidates ·{" "}
                      {context.saved_judgment_count} saved
                    </span>
                  </button>
                ))}
              </div>
              <input
                className="input"
                value={newContextName}
                onChange={(event) => setNewContextName(event.target.value)}
                placeholder="Emotion batch 01"
              />
              <textarea
                className="textarea"
                value={generationGoal}
                onChange={(event) => setGenerationGoal(event.target.value)}
                placeholder="Generation goal"
              />
              <button className="button secondary" onClick={createContext} disabled={busy === "context"}>
                <Save size={16} aria-hidden /> Context
              </button>
            </div>
          ) : null}
        </aside>

        <section className="main-workspace">
          <div className="stack">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h2>{activeContext?.name || detail?.profile.name || "Generation context"}</h2>
                  <div className="microcopy">
                    {activeContext?.generation_goal || detail?.profile.style_summary || "No saved generation context yet."}
                  </div>
                  {activeContext ? (
                    <div className="microcopy">
                      {activeContext.asset_focus} · {activeContext.reference_strength} reference strength
                      {activeContext.confidence_reasons.length
                        ? ` · ${activeContext.confidence_reasons.join(", ")}`
                        : ""}
                    </div>
                  ) : null}
                </div>
                <div className="toolbar">
                  {selectedProfileId ? (
                    <>
                      <a className="button secondary" href={`/api/style-profiles/${selectedProfileId}/export.json`}>
                        <Download size={16} aria-hidden /> JSON
                      </a>
                      <a className="button secondary" href={`/api/style-profiles/${selectedProfileId}/export.md`}>
                        <Download size={16} aria-hidden /> MD
                      </a>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Context source assets</h2>
                  <div className="microcopy">Assets actually used for this generation context.</div>
                </div>
                <button
                  className="button secondary icon-button"
                  onClick={() => sourceInputRef.current?.click()}
                  disabled={!activeContext}
                >
                  <Upload size={16} aria-label="Upload context source assets" />
                </button>
              </div>
              <div className="form-row" style={{ marginTop: 12 }}>
                <select className="select" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                  {assetTypes.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  value={sourceNote}
                  onChange={(event) => setSourceNote(event.target.value)}
                  placeholder="Source note"
                />
              </div>
              <input
                className="hidden-input"
                ref={sourceInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => uploadContextSources(event.target.files)}
              />
              <div className="reference-grid">
                {activeContext?.sourceAssets.map((asset) => (
                  <div className="asset-tile" key={asset.id}>
                    <div className="asset-thumb">
                      {asset.imageUrl ? <img src={asset.imageUrl} alt={asset.snapshot_note || asset.asset_type} /> : null}
                    </div>
                    <div className="asset-meta">
                      <strong>{asset.origin}</strong>
                      <div>{asset.snapshot_note || asset.asset_type}</div>
                    </div>
                  </div>
                ))}
                {activeContext && activeContext.sourceAssets.length === 0 ? (
                  <div className="status">Add the assets you actually used for this generation.</div>
                ) : null}
              </div>
            </section>

            <div className="comparison-grid">
              <section className="panel">
                <div className="panel-header">
                  <h2>Reference assets</h2>
                  <button className="button secondary icon-button" onClick={() => referenceInputRef.current?.click()}>
                    <Upload size={16} aria-label="Upload reference assets" />
                  </button>
                </div>
                <div className="form-row" style={{ marginTop: 12 }}>
                  <select className="select" value={referenceType} onChange={(event) => setReferenceType(event.target.value)}>
                    {assetTypes.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    value={referenceNote}
                    onChange={(event) => setReferenceNote(event.target.value)}
                    placeholder="Optional note"
                  />
                </div>
                <input
                  className="hidden-input"
                  ref={referenceInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) => uploadReferences(event.target.files)}
                />
                <div className="reference-grid">
                  {detail?.referenceAssets.map((asset) => (
                    <div className="asset-tile" key={asset.id}>
                      <div className="asset-thumb">
                        {asset.imageUrl ? <img src={asset.imageUrl} alt={asset.note || asset.asset_type} /> : null}
                      </div>
                      <div className="asset-meta">
                        <div className="asset-meta-header">
                          <strong>{asset.asset_type}</strong>
                          <div className="toolbar">
                            <button
                              className="small-icon-button"
                              onClick={() => addProfileReferenceToContext(asset.id)}
                              disabled={!activeContext || busy === `source-add-${asset.id}`}
                              title="Use as context source"
                            >
                              <ImagePlus size={14} aria-label="Use as context source" />
                            </button>
                            <button
                              className="small-icon-button"
                              onClick={() => deleteReferenceAsset(asset.id)}
                              disabled={busy === `reference-delete-${asset.id}`}
                              title="Remove reference"
                            >
                              <Trash2 size={14} aria-label="Remove reference" />
                            </button>
                          </div>
                        </div>
                        <div>{asset.note || "No note"}</div>
                      </div>
                    </div>
                  ))}
                  {detail?.referenceAssets.length === 0 ? (
                    <div className="status">Upload 3-8 reference images to make evaluator guidance stronger.</div>
                  ) : null}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2>Candidate image</h2>
                  <div className="toolbar">
                    {currentCandidate ? (
                      <button
                        className="button secondary icon-button danger-outline"
                        onClick={deleteCurrentCandidate}
                        disabled={busy === "candidate-delete"}
                        title="Remove candidate"
                      >
                        <Trash2 size={16} aria-label="Remove candidate" />
                      </button>
                    ) : null}
                    <button className="button secondary icon-button" onClick={() => candidateInputRef.current?.click()}>
                      <ImagePlus size={16} aria-label="Upload candidate image" />
                    </button>
                  </div>
                </div>
                <input
                  className="hidden-input"
                  ref={candidateInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      uploadCandidate(file).catch((error) =>
                        setStatus({ kind: "error", text: error instanceof Error ? error.message : "Upload failed." })
                      );
                    }
                  }}
                />
                <div style={{ marginTop: 12 }}>
                  {currentCandidate?.originalUrl ? (
                    <div className="candidate-viewer">
                      <img src={currentCandidate.originalUrl} alt="Current candidate" />
                    </div>
                  ) : (
                    <div className="candidate-drop">
                      <div>
                        <Clipboard size={28} aria-hidden />
                        <p>Paste an image or upload a candidate.</p>
                        <p className="microcopy">PNG, JPEG, and WebP. SVG is blocked in v1.</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="candidate-actions" style={{ marginTop: 12 }}>
                  <textarea
                    className="textarea"
                    value={promptText}
                    onChange={(event) => {
                      setPromptText(event.target.value);
                      if (event.target.value.trim()) {
                        setPromptMissing(false);
                      }
                    }}
                    placeholder="Prompt used to generate this candidate"
                  />
                  <div className="form-row">
                    <input
                      className="input"
                      value={generationTool}
                      onChange={(event) => setGenerationTool(event.target.value)}
                      placeholder="Generation tool"
                    />
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={promptMissing}
                        onChange={(event) => setPromptMissing(event.target.checked)}
                      />
                      Prompt missing
                    </label>
                  </div>
                  {promptMissing ? (
                    <textarea
                      className="textarea"
                      value={recoveryNote}
                      onChange={(event) => setRecoveryNote(event.target.value)}
                      placeholder="Recovery note: what do you remember about the generation intent?"
                    />
                  ) : null}
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="panel-header">
                <h2>History</h2>
                <span className="microcopy">{savedEvaluations.length} saved judgments</span>
              </div>
              <div className="history-list" style={{ marginTop: 12 }}>
                {history.map((item) => {
                  const evaluation = item.evaluations[0];
                  return (
                    <button className="history-item" key={item.candidate.id} onClick={() => selectCandidate(item.candidate)}>
                      <strong>{item.generationContext?.name || item.session.name}</strong>
                      <span>
                        {evaluation ? (
                          <>
                            <span className={`decision-${evaluation.decision_label}`}>{evaluation.decision_label}</span> ·{" "}
                            {evaluation.fit_score} · {evaluation.confidence_state}
                          </>
                        ) : (
                          "No evaluation yet"
                        )}
                      </span>
                    </button>
                  );
                })}
                {history.length === 0 ? <div className="status">No candidates saved yet.</div> : null}
              </div>
            </section>
          </div>
        </section>

        <aside className="inspector">
          <div className="stack">
            <div className="panel-header">
              <h2>Judgment</h2>
              <Sparkles size={18} aria-hidden />
            </div>

            {status ? <div className={`status ${status.kind === "info" ? "" : status.kind}`}>{status.text}</div> : null}

            {activeContext && activeContext.reference_strength !== "strong" ? (
              <div className="warning">
                Weak context source set: add source assets or prompt details for stronger evaluator guidance.
              </div>
            ) : null}

            {activeEvaluation ? (
              <div className="score-box">
                <div className="score-number">{activeEvaluation.fit_score}</div>
                <div>
                  <strong>{activeEvaluation.decision_label}</strong>
                  <p className="microcopy">{activeEvaluation.ai_summary}</p>
                </div>
              </div>
            ) : (
              <div className="status">Run evaluation to create a draft, or save a manual judgment directly.</div>
            )}

            <button className="button" onClick={evaluateCandidate} disabled={!currentCandidate || busy === "evaluate"}>
              {busy === "evaluate" ? <Loader2 size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
              Evaluate candidate
            </button>

            {draft?.weak_reference_set ? (
              <div className="warning">Evaluation allowed, but marked weak because fewer than 3 references exist.</div>
            ) : null}

            {activeCriteria.length > 0 ? (
              <div className="criterion-list">
                {activeCriteria.map((criterion) => (
                  <div className="criterion-row" key={criterion.criterion}>
                    <strong>
                      {criterion.criterion} · {criterion.score}
                    </strong>
                    <span>{criterion.reason}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="form-grid">
              <label className="section-title" htmlFor="decision">
                Human decision
              </label>
              <select
                id="decision"
                className="select"
                value={decisionLabel}
                onChange={(event) => setDecisionLabel(event.target.value as DecisionLabel)}
              >
                <option value="good">Good</option>
                <option value="needs_edit">Needs edit</option>
                <option value="reject">Reject</option>
              </select>

              <label className="section-title" htmlFor="human-reason">
                Human reason
              </label>
              <textarea
                id="human-reason"
                className="textarea"
                value={humanReason}
                onChange={(event) => setHumanReason(event.target.value)}
                placeholder="Why is this usable, fixable, or wrong for this playable?"
              />

              <label className="section-title" htmlFor="guidance">
                Next prompt guidance
              </label>
              <textarea
                id="guidance"
                className="textarea"
                value={guidanceText}
                onChange={(event) => setGuidanceText(event.target.value)}
                placeholder="Reusable guidance for the next generation"
              />

              <div className="form-row">
                <button className="button secondary" onClick={copyGuidance} disabled={!guidanceText.trim()}>
                  <Copy size={16} aria-hidden /> Copy
                </button>
                <button className="button" onClick={saveJudgment} disabled={!currentCandidate || busy === "save"}>
                  <Save size={16} aria-hidden /> Save
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
