"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActiveContextHeader,
  CandidatePanel,
  ContextSidebar,
  ContextSourceAssets,
  JudgmentPanel,
  PromptRevisionStrip,
  SecondaryMemoryPanel
} from "./workspace-components";
import type {
  Candidate,
  DecisionLabel,
  Draft,
  HistoryItem,
  ProfileDetail,
  PromptGuidance,
  RevisionUploadMode,
  SourceGuidanceOption,
  StyleProfile,
  WorkspaceStatus
} from "./workspace-types";

export function WorkspaceClient() {
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const candidateInputRef = useRef<HTMLInputElement | null>(null);
  const [profiles, setProfiles] = useState<StyleProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const [selectedPromptRevisionId, setSelectedPromptRevisionId] = useState<string | null>(null);
  const [currentCandidate, setCurrentCandidate] = useState<Candidate | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [newContextName, setNewContextName] = useState("");
  const [generationGoal, setGenerationGoal] = useState("");
  const [contextPrompt, setContextPrompt] = useState("");
  const [referenceType, setReferenceType] = useState("card");
  const [referenceNote, setReferenceNote] = useState("");
  const [sourceType, setSourceType] = useState("character");
  const [sourceNote, setSourceNote] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptMissing, setPromptMissing] = useState(false);
  const [recoveryNote, setRecoveryNote] = useState("");
  const [generationTool, setGenerationTool] = useState("NanoBanana2");
  const [revisionUploadMode, setRevisionUploadMode] = useState<RevisionUploadMode>("new_root");
  const [parentPromptRevisionId, setParentPromptRevisionId] = useState<string | null>(null);
  const [attachPromptRevisionId, setAttachPromptRevisionId] = useState<string | null>(null);
  const [revisionLabel, setRevisionLabel] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [parametersJson, setParametersJson] = useState("");
  const [sourceGuidanceId, setSourceGuidanceId] = useState<string | null>(null);
  const [decisionLabel, setDecisionLabel] = useState<DecisionLabel>("needs_edit");
  const [humanReason, setHumanReason] = useState("");
  const [guidanceText, setGuidanceText] = useState("");
  const [lastSavedGuidance, setLastSavedGuidance] = useState<PromptGuidance | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);

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

  const activePromptRevisions = useMemo(() => activeContext?.promptRevisions || [], [activeContext?.promptRevisions]);
  const activePromptRevisionIds = useMemo(
    () => new Set(activePromptRevisions.map((revision) => revision.id)),
    [activePromptRevisions]
  );
  const defaultRevisionTargetId =
    selectedPromptRevisionId && activePromptRevisionIds.has(selectedPromptRevisionId)
      ? selectedPromptRevisionId
      : activePromptRevisions[0]?.id || null;
  const activeSourceGuidanceOptions = useMemo<SourceGuidanceOption[]>(() => {
    if (!activeContext) {
      return [];
    }
    return history
      .filter((item) => item.generationContext.id === activeContext.id)
      .flatMap((item) =>
        item.evaluations
          .filter((evaluation) => evaluation.evaluation_state === "saved")
          .flatMap((evaluation) =>
            (evaluation.prompt_guidance || [])
              .filter((guidance) => guidance.id && guidance.evaluation_id)
              .map((guidance) => ({
                id: guidance.id,
                evaluation_id: guidance.evaluation_id as string,
                candidate_id: item.candidate.id,
                guidance_text: guidance.guidance_text,
                confidence_state: guidance.confidence_state,
                human_modified: guidance.human_modified,
                created_at: guidance.created_at,
                decision_label: evaluation.decision_label,
                fit_score: evaluation.fit_score
              }))
          )
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id));
  }, [activeContext, history]);
  const activeSourceGuidanceIds = useMemo(
    () => new Set(activeSourceGuidanceOptions.map((guidance) => guidance.id)),
    [activeSourceGuidanceOptions]
  );

  const loadProfiles = useCallback(async () => {
    const response = await fetch("/api/style-profiles", { cache: "no-store" });
    const data = (await response.json()) as { profiles: StyleProfile[] };
    setProfiles(data.profiles);
    setSelectedProfileId((current) => current || data.profiles[0]?.id || null);
  }, []);

  const loadDetail = useCallback(async (profileId: string, preferredContextId?: string | null) => {
    const [detailResponse, historyResponse] = await Promise.all([
      fetch(`/api/style-profiles/${profileId}`, { cache: "no-store" }),
      fetch(`/api/style-profiles/${profileId}/history`, { cache: "no-store" })
    ]);
    const detailData = (await detailResponse.json()) as ProfileDetail;
    const historyData = (await historyResponse.json()) as { history: HistoryItem[] };
    setDetail(detailData);
    setHistory(historyData.history);
    const requestedContextId = preferredContextId ?? selectedContextId;
    const nextContext =
      detailData.generationContexts.find((context) => context.id === requestedContextId) ||
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
      setSelectedPromptRevisionId(null);
      resetRevisionAuthoring(null);
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
    if (!activeContext) {
      return;
    }
    if (revisionUploadMode !== "new_root" && activePromptRevisions.length === 0) {
      setRevisionUploadMode("new_root");
    }
    setParentPromptRevisionId((current) =>
      current && activePromptRevisionIds.has(current) ? current : defaultRevisionTargetId
    );
    setAttachPromptRevisionId((current) =>
      current && activePromptRevisionIds.has(current) ? current : defaultRevisionTargetId
    );
  }, [activeContext, activePromptRevisionIds, activePromptRevisions.length, defaultRevisionTargetId, revisionUploadMode]);

  useEffect(() => {
    setSourceGuidanceId((current) => (current && activeSourceGuidanceIds.has(current) ? current : null));
  }, [activeSourceGuidanceIds]);

  useEffect(() => {
    if (!activeContext) {
      setSelectedPromptRevisionId(null);
      return;
    }
    if (currentCandidate?.generation_context_id === activeContext.id) {
      setSelectedPromptRevisionId(currentCandidate.prompt_revision_id || null);
      return;
    }
    setSelectedPromptRevisionId((current) =>
      current && activePromptRevisions.some((revision) => revision.id === current) ? current : activePromptRevisions[0]?.id || null
    );
  }, [activeContext, activePromptRevisions, currentCandidate?.generation_context_id, currentCandidate?.prompt_revision_id]);

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
  const savedGuidanceForCurrentCandidate = useMemo(() => {
    if (!currentCandidate) {
      return null;
    }
    const savedEvaluation = history
      .find((item) => item.candidate.id === currentCandidate.id)
      ?.evaluations.find((evaluation) => evaluation.evaluation_state === "saved");
    return savedEvaluation?.prompt_guidance?.[0] || null;
  }, [currentCandidate, history]);
  const activeSavedGuidance =
    lastSavedGuidance && lastSavedGuidance.guidance_text === guidanceText.trim()
      ? lastSavedGuidance
      : savedGuidanceForCurrentCandidate?.guidance_text === guidanceText.trim()
        ? savedGuidanceForCurrentCandidate
        : null;

  function selectCandidate(candidate: Candidate) {
    setCurrentCandidate(candidate);
    setSelectedPromptRevisionId(candidate.prompt_revision_id || null);
    if (candidate.prompt_revision_id) {
      setParentPromptRevisionId(candidate.prompt_revision_id);
      setAttachPromptRevisionId(candidate.prompt_revision_id);
    }
    setPromptText(candidate.prompt_text || "");
    setPromptMissing(candidate.prompt_missing === 1 || !candidate.prompt_text);
    setRecoveryNote(candidate.recovery_note || "");
    setDraft(null);
    const historyItem = history.find((item) => item.candidate.id === candidate.id);
    const latest = historyItem?.evaluations.find((evaluation) => evaluation.evaluation_state !== "failed");
    const savedGuidance = historyItem?.evaluations.find((evaluation) => evaluation.evaluation_state === "saved")?.prompt_guidance?.[0] || null;
    setLastSavedGuidance(savedGuidance);
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

  function selectPromptRevision(revisionId: string) {
    setSelectedPromptRevisionId(revisionId);
    setParentPromptRevisionId(revisionId);
    setAttachPromptRevisionId(revisionId);
    const linkedCandidate = activeContextCandidates.find((candidate) => candidate.prompt_revision_id === revisionId);
    if (linkedCandidate) {
      selectCandidate(linkedCandidate);
    }
  }

  function resetRevisionAuthoring(defaultRevisionId = defaultRevisionTargetId) {
    setRevisionUploadMode("new_root");
    setParentPromptRevisionId(defaultRevisionId);
    setAttachPromptRevisionId(defaultRevisionId);
    setRevisionLabel("");
    setRevisionNote("");
    setNegativePrompt("");
    setParametersJson("");
    setSourceGuidanceId(null);
  }

  function handlePromptMissingChange(value: boolean) {
    setPromptMissing(value);
    if (value) {
      resetRevisionAuthoring();
    } else {
      setRevisionUploadMode("new_root");
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
          sourcePrompt: contextPrompt,
          toolName: generationTool
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      setNewContextName("");
      setGenerationGoal("");
      setContextPrompt("");
      setSelectedContextId(data.generationContext.id);
      setSelectedPromptRevisionId(null);
      resetRevisionAuthoring(null);
      await loadDetail(selectedProfileId, data.generationContext.id);
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
      const normalizedParametersJson =
        !promptMissing && revisionUploadMode !== "attach_existing" ? normalizeParametersJsonForUpload(parametersJson) : null;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("recoveryNote", recoveryNote);
      formData.append("generationTool", generationTool);
      if (promptMissing) {
        formData.append("promptMissing", "true");
      } else if (revisionUploadMode === "attach_existing") {
        const targetRevisionId = attachPromptRevisionId || defaultRevisionTargetId;
        if (!targetRevisionId) {
          throw new Error("Select a prompt revision to attach.");
        }
        formData.append("promptRevisionId", targetRevisionId);
        formData.append("promptMissing", "false");
      } else {
        if (revisionUploadMode === "new_child") {
          const parentRevisionId = parentPromptRevisionId || defaultRevisionTargetId;
          if (!parentRevisionId) {
            throw new Error("Select a parent prompt revision.");
          }
          if (!promptText.trim()) {
            throw new Error("Prompt text is required to create a child revision.");
          }
          formData.append("parentPromptRevisionId", parentRevisionId);
        }
        formData.append("promptText", promptText);
        formData.append("promptMissing", String(!promptText.trim()));
        appendIfPresent(formData, "revisionLabel", revisionLabel);
        appendIfPresent(formData, "revisionNote", revisionNote);
        appendIfPresent(formData, "negativePrompt", negativePrompt);
        if (sourceGuidanceId) {
          formData.append("sourceGuidanceId", sourceGuidanceId);
        }
        if (normalizedParametersJson) {
          formData.append("parametersJson", normalizedParametersJson);
        }
      }

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
      setRevisionLabel("");
      setRevisionNote("");
      setNegativePrompt("");
      setParametersJson("");
      setSourceGuidanceId(null);
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
      setLastSavedGuidance(null);
      setDecisionLabel(data.draft.evaluation.decision_label);
      setGuidanceText(data.draft.next_prompt_guidance);
      setStatus({
        kind: "ok",
        text: data.draft.weak_reference_set ? "Draft evaluation saved with weak reference set warning." : "Draft evaluation saved."
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
      setLastSavedGuidance(data.guidance || null);
      setStatus({ kind: "ok", text: "Judgment saved to creative memory." });
      if (selectedProfileId) {
        await loadDetail(selectedProfileId);
      }
      setDraft(null);
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

  async function createNextRevision() {
    if (!selectedProfileId || !activeContext || !activeSavedGuidance) {
      return;
    }

    setBusy("create-revision");
    try {
      const response = await fetch(`/api/generation-contexts/${activeContext.id}/prompt-revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptText: activeSavedGuidance.guidance_text,
          parentPromptRevisionId: currentCandidate?.prompt_revision_id || null,
          sourceGuidanceId: activeSavedGuidance.id,
          revisionLabel: "next revision",
          revisionNote: "Created from saved judgment guidance."
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }

      await loadDetail(selectedProfileId, activeContext.id);
      setSelectedPromptRevisionId(data.promptRevision.id);
      setAttachPromptRevisionId(data.promptRevision.id);
      setParentPromptRevisionId(data.promptRevision.id);
      setPromptText(data.promptRevision.prompt_text);
      setPromptMissing(false);
      setRevisionUploadMode("attach_existing");
      setStatus({ kind: "ok", text: "Next prompt revision created." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to create prompt revision." });
    } finally {
      setBusy(null);
    }
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
      setSelectedPromptRevisionId(null);
      resetRevisionAuthoring(null);
      setDraft(null);
      setPromptText("");
      setPromptMissing(false);
      setRecoveryNote("");
      setDecisionLabel("needs_edit");
      setHumanReason("");
      setGuidanceText("");
      setLastSavedGuidance(null);
      await loadDetail(selectedProfileId);
      setStatus({ kind: "ok", text: "Candidate image removed." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to remove candidate." });
    } finally {
      setBusy(null);
    }
  }

  const currentHistoryItem = useMemo(
    () => (currentCandidate ? history.find((item) => item.candidate.id === currentCandidate.id) || null : null),
    [currentCandidate, history]
  );
  const latestStoredEvaluation = currentHistoryItem?.evaluations[0] || null;
  const activeEvaluation = draft?.evaluation || latestStoredEvaluation || undefined;
  const activeCriteria = draft?.criteria || latestStoredEvaluation?.criteria || [];

  return (
    <main className="workspace">
      <div className="desktop-blocker">
        <div className="desktop-blocker__box">
          <h1>Desktop workspace required</h1>
          <p>Asset Evaluator v1 needs at least 1024px width for side-by-side visual judgment.</p>
        </div>
      </div>

      <div className="workspace-shell">
        <ContextSidebar
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          detail={detail}
          activeContextId={activeContext?.id || null}
          newProfileName={newProfileName}
          newContextName={newContextName}
          generationGoal={generationGoal}
          contextPrompt={contextPrompt}
          sourceType={sourceType}
          generationTool={generationTool}
          busy={busy}
          onSelectProfile={(profileId) => {
            setSelectedProfileId(profileId);
            setSelectedContextId(null);
            setSelectedPromptRevisionId(null);
            resetRevisionAuthoring(null);
            setCurrentCandidate(null);
            setDraft(null);
            setLastSavedGuidance(null);
          }}
          onSelectContext={(contextId) => {
            setSelectedContextId(contextId);
            setSelectedPromptRevisionId(null);
            resetRevisionAuthoring(null);
            setCurrentCandidate(null);
            setDraft(null);
            setLastSavedGuidance(null);
          }}
          onNewProfileNameChange={setNewProfileName}
          onNewContextNameChange={setNewContextName}
          onGenerationGoalChange={setGenerationGoal}
          onContextPromptChange={setContextPrompt}
          onSourceTypeChange={setSourceType}
          onGenerationToolChange={setGenerationTool}
          onCreateProfile={createProfile}
          onCreateContext={createContext}
        />

        <section className="main-workspace" aria-label="Generation context workspace">
          <div className="stack">
            <ActiveContextHeader activeContext={activeContext} profile={detail?.profile} selectedProfileId={selectedProfileId} />

            <ContextSourceAssets
              activeContext={activeContext}
              sourceInputRef={sourceInputRef}
              sourceType={sourceType}
              sourceNote={sourceNote}
              busy={busy}
              onSourceTypeChange={setSourceType}
              onSourceNoteChange={setSourceNote}
              onUploadContextSources={uploadContextSources}
            />

            <CandidatePanel
              currentCandidate={currentCandidate}
              candidates={activeContextCandidates}
              history={history}
              draft={draft}
              candidateInputRef={candidateInputRef}
              promptText={promptText}
              promptMissing={promptMissing}
              recoveryNote={recoveryNote}
              generationTool={generationTool}
              promptRevisions={activePromptRevisions}
              selectedPromptRevisionId={selectedPromptRevisionId}
              revisionUploadMode={revisionUploadMode}
              parentPromptRevisionId={parentPromptRevisionId}
              attachPromptRevisionId={attachPromptRevisionId}
              revisionLabel={revisionLabel}
              revisionNote={revisionNote}
              negativePrompt={negativePrompt}
              parametersJson={parametersJson}
              sourceGuidanceOptions={activeSourceGuidanceOptions}
              sourceGuidanceId={sourceGuidanceId}
              busy={busy}
              onPromptTextChange={setPromptText}
              onPromptMissingChange={handlePromptMissingChange}
              onRecoveryNoteChange={setRecoveryNote}
              onGenerationToolChange={setGenerationTool}
              onRevisionUploadModeChange={setRevisionUploadMode}
              onParentPromptRevisionIdChange={setParentPromptRevisionId}
              onAttachPromptRevisionIdChange={setAttachPromptRevisionId}
              onRevisionLabelChange={setRevisionLabel}
              onRevisionNoteChange={setRevisionNote}
              onNegativePromptChange={setNegativePrompt}
              onParametersJsonChange={setParametersJson}
              onSourceGuidanceIdChange={setSourceGuidanceId}
              onSelectCandidate={selectCandidate}
              onUploadCandidate={(file) =>
                uploadCandidate(file).catch((error) =>
                  setStatus({ kind: "error", text: error instanceof Error ? error.message : "Upload failed." })
                )
              }
              onDeleteCurrentCandidate={deleteCurrentCandidate}
            />

            <PromptRevisionStrip
              activeContext={activeContext}
              selectedPromptRevisionId={selectedPromptRevisionId}
              onSelectRevision={selectPromptRevision}
            />

            <SecondaryMemoryPanel
              detail={detail}
              referenceInputRef={referenceInputRef}
              referenceType={referenceType}
              referenceNote={referenceNote}
              activeContext={activeContext}
              busy={busy}
              onReferenceTypeChange={setReferenceType}
              onReferenceNoteChange={setReferenceNote}
              onUploadReferences={uploadReferences}
              onAddProfileReferenceToContext={addProfileReferenceToContext}
              onDeleteReferenceAsset={deleteReferenceAsset}
              history={history}
              savedEvaluationCount={savedEvaluations.length}
              onSelectCandidate={selectCandidate}
            />
          </div>
        </section>

        <JudgmentPanel
          status={status}
          activeContext={activeContext}
          activeEvaluation={activeEvaluation}
          activeCriteria={activeCriteria}
          draft={draft}
          currentCandidate={currentCandidate}
          busy={busy}
          decisionLabel={decisionLabel}
          humanReason={humanReason}
          guidanceText={guidanceText}
          activeSavedGuidance={activeSavedGuidance}
          onEvaluateCandidate={evaluateCandidate}
          onDecisionLabelChange={setDecisionLabel}
          onHumanReasonChange={setHumanReason}
          onGuidanceTextChange={setGuidanceText}
          onCopyGuidance={copyGuidance}
          onSaveJudgment={saveJudgment}
          onCreateNextRevision={createNextRevision}
        />
      </div>
    </main>
  );
}

function appendIfPresent(formData: FormData, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    formData.append(key, trimmed);
  }
}

function normalizeParametersJsonForUpload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Parameters JSON must be a valid JSON object.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) {
    throw new Error("Parameters JSON must be a valid JSON object.");
  }

  return JSON.stringify(parsed);
}
