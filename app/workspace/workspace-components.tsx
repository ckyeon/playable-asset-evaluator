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
import type { RefObject } from "react";
import type {
  Candidate,
  Criterion,
  DecisionLabel,
  Draft,
  Evaluation,
  GenerationContext,
  HistoryItem,
  ProfileDetail,
  StyleProfile,
  WorkspaceStatus
} from "./workspace-types";
import { assetTypes } from "./workspace-types";

interface ContextSidebarProps {
  profiles: StyleProfile[];
  selectedProfileId: string | null;
  detail: ProfileDetail | null;
  activeContextId: string | null;
  newProfileName: string;
  newContextName: string;
  generationGoal: string;
  contextPrompt: string;
  sourceType: string;
  generationTool: string;
  busy: string | null;
  onSelectProfile: (profileId: string) => void;
  onSelectContext: (contextId: string) => void;
  onNewProfileNameChange: (value: string) => void;
  onNewContextNameChange: (value: string) => void;
  onGenerationGoalChange: (value: string) => void;
  onContextPromptChange: (value: string) => void;
  onSourceTypeChange: (value: string) => void;
  onGenerationToolChange: (value: string) => void;
  onCreateProfile: () => void;
  onCreateContext: () => void;
}

export function ContextSidebar({
  profiles,
  selectedProfileId,
  detail,
  activeContextId,
  newProfileName,
  newContextName,
  generationGoal,
  contextPrompt,
  sourceType,
  generationTool,
  busy,
  onSelectProfile,
  onSelectContext,
  onNewProfileNameChange,
  onNewContextNameChange,
  onGenerationGoalChange,
  onContextPromptChange,
  onSourceTypeChange,
  onGenerationToolChange,
  onCreateProfile,
  onCreateContext
}: ContextSidebarProps) {
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand-row">
        <h1>Asset Evaluator</h1>
        <FileImage size={18} aria-hidden />
      </div>

      <section className="sidebar-section" aria-labelledby="style-profiles-heading">
        <h2 id="style-profiles-heading" className="section-title">
          Style profiles
        </h2>
        <div className="profile-list" aria-label="Style profiles">
          {profiles.map((profile) => (
            <button
              className={`profile-button ${profile.id === selectedProfileId ? "is-active" : ""}`}
              key={profile.id}
              onClick={() => onSelectProfile(profile.id)}
            >
              <strong>{profile.name}</strong>
              <span>{profile.description || "Reusable visual judgment memory"}</span>
            </button>
          ))}
        </div>
      </section>

      {detail ? (
        <section className="sidebar-section" aria-labelledby="generation-contexts-heading">
          <h2 id="generation-contexts-heading" className="section-title">
            Generation contexts
          </h2>
          <div className="profile-list context-list" aria-label="Generation contexts">
            {detail.generationContexts.map((context) => (
              <button
                className={`profile-button context-button ${context.id === activeContextId ? "is-active" : ""}`}
                key={context.id}
                onClick={() => onSelectContext(context.id)}
              >
                <strong>{context.name}</strong>
                <span>
                  {context.reference_strength} · {context.candidate_count} candidates · {context.saved_judgment_count} saved
                </span>
              </button>
            ))}
            {detail.generationContexts.length === 0 ? (
              <div className="status compact-status">Create the first generation context for this style.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {detail ? (
        <section className="sidebar-section create-context" aria-labelledby="new-context-heading">
          <h2 id="new-context-heading" className="section-title">
            New context
          </h2>
          <label className="field-label" htmlFor="context-name">
            Context name
          </label>
          <input
            id="context-name"
            className="input"
            value={newContextName}
            onChange={(event) => onNewContextNameChange(event.target.value)}
            placeholder="Emotion batch 01"
          />
          <label className="field-label" htmlFor="generation-goal">
            Generation goal
          </label>
          <textarea
            id="generation-goal"
            className="textarea compact-textarea"
            value={generationGoal}
            onChange={(event) => onGenerationGoalChange(event.target.value)}
            placeholder="Reusable emotion poses"
          />
          <label className="field-label" htmlFor="context-source-prompt">
            Source prompt
          </label>
          <textarea
            id="context-source-prompt"
            className="textarea compact-textarea"
            value={contextPrompt}
            onChange={(event) => onContextPromptChange(event.target.value)}
            placeholder="Prompt used for this generation batch"
          />
          <div className="form-row single-column">
            <select
              className="select"
              aria-label="Context asset focus"
              value={sourceType}
              onChange={(event) => onSourceTypeChange(event.target.value)}
            >
              {assetTypes.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="input"
              aria-label="Generation tool"
              value={generationTool}
              onChange={(event) => onGenerationToolChange(event.target.value)}
              placeholder="Generation tool"
            />
          </div>
          <button className="button secondary" onClick={onCreateContext} disabled={busy === "context"}>
            <Save size={16} aria-hidden /> Create context
          </button>
        </section>
      ) : null}

      <section className="sidebar-section create-profile" aria-labelledby="new-profile-heading">
        <h2 id="new-profile-heading" className="section-title">
          New profile
        </h2>
        <label className="field-label" htmlFor="profile-name">
          Profile name
        </label>
        <input
          id="profile-name"
          className="input"
          value={newProfileName}
          onChange={(event) => onNewProfileNameChange(event.target.value)}
          placeholder="Puzzle reward bright casual"
        />
        <button className="button secondary" onClick={onCreateProfile} disabled={busy === "profile"}>
          <Save size={16} aria-hidden /> Create
        </button>
      </section>
    </aside>
  );
}

interface ActiveContextHeaderProps {
  activeContext: GenerationContext | null;
  profile: StyleProfile | null | undefined;
  selectedProfileId: string | null;
}

export function ActiveContextHeader({ activeContext, profile, selectedProfileId }: ActiveContextHeaderProps) {
  return (
    <div className="panel active-context-header">
      <div className="panel-header">
        <div>
          <h2>{activeContext?.name || profile?.name || "Generation context"}</h2>
          <div className="microcopy">{activeContext?.generation_goal || profile?.style_summary || "No saved generation context yet."}</div>
          {activeContext ? (
            <div className="confidence-row" aria-label="Context confidence">
              <span>{activeContext.asset_focus}</span>
              <span>{activeContext.reference_strength} reference strength</span>
              {activeContext.confidence_reasons.map((reason) => (
                <span className="confidence-badge" key={reason}>
                  {reason}
                </span>
              ))}
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
  );
}

interface ContextSourceAssetsProps {
  activeContext: GenerationContext | null;
  sourceInputRef: RefObject<HTMLInputElement | null>;
  sourceType: string;
  sourceNote: string;
  busy: string | null;
  onSourceTypeChange: (value: string) => void;
  onSourceNoteChange: (value: string) => void;
  onUploadContextSources: (files: FileList | null) => void;
}

export function ContextSourceAssets({
  activeContext,
  sourceInputRef,
  sourceType,
  sourceNote,
  busy,
  onSourceTypeChange,
  onSourceNoteChange,
  onUploadContextSources
}: ContextSourceAssetsProps) {
  return (
    <section className="panel" aria-labelledby="context-source-assets-heading">
      <div className="panel-header">
        <div>
          <h2 id="context-source-assets-heading">Context source assets</h2>
          <div className="microcopy">Assets actually used for this generation context.</div>
        </div>
        <button
          className="button secondary icon-button"
          onClick={() => sourceInputRef.current?.click()}
          disabled={!activeContext || busy === "source-upload"}
          aria-label="Upload context source assets"
          title="Upload context source assets"
        >
          <Upload size={16} aria-hidden />
        </button>
      </div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <select className="select" value={sourceType} onChange={(event) => onSourceTypeChange(event.target.value)}>
          {assetTypes.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={sourceNote}
          onChange={(event) => onSourceNoteChange(event.target.value)}
          placeholder="Source note"
          aria-label="Context source note"
        />
      </div>
      <input
        className="hidden-input"
        data-testid="context-source-file-input"
        ref={sourceInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(event) => onUploadContextSources(event.target.files)}
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
          <div className="status grid-status">Add the assets you actually used for this generation.</div>
        ) : null}
      </div>
    </section>
  );
}

interface ReferenceAssetsPanelProps {
  detail: ProfileDetail | null;
  referenceInputRef: RefObject<HTMLInputElement | null>;
  referenceType: string;
  referenceNote: string;
  activeContext: GenerationContext | null;
  busy: string | null;
  onReferenceTypeChange: (value: string) => void;
  onReferenceNoteChange: (value: string) => void;
  onUploadReferences: (files: FileList | null) => void;
  onAddProfileReferenceToContext: (referenceAssetId: string) => void;
  onDeleteReferenceAsset: (referenceAssetId: string) => void;
}

export function ReferenceAssetsPanel({
  detail,
  referenceInputRef,
  referenceType,
  referenceNote,
  activeContext,
  busy,
  onReferenceTypeChange,
  onReferenceNoteChange,
  onUploadReferences,
  onAddProfileReferenceToContext,
  onDeleteReferenceAsset
}: ReferenceAssetsPanelProps) {
  return (
    <section className="panel" aria-labelledby="reference-assets-heading">
      <div className="panel-header">
        <h2 id="reference-assets-heading">Reference assets</h2>
        <button
          className="button secondary icon-button"
          onClick={() => referenceInputRef.current?.click()}
          aria-label="Upload reference assets"
          title="Upload reference assets"
        >
          <Upload size={16} aria-hidden />
        </button>
      </div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <select className="select" value={referenceType} onChange={(event) => onReferenceTypeChange(event.target.value)}>
          {assetTypes.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={referenceNote}
          onChange={(event) => onReferenceNoteChange(event.target.value)}
          placeholder="Optional note"
          aria-label="Reference note"
        />
      </div>
      <input
        className="hidden-input"
        data-testid="reference-file-input"
        ref={referenceInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(event) => onUploadReferences(event.target.files)}
      />
      <div className="reference-grid">
        {detail?.referenceAssets.map((asset) => (
          <div className="asset-tile" key={asset.id}>
            <div className="asset-thumb">{asset.imageUrl ? <img src={asset.imageUrl} alt={asset.note || asset.asset_type} /> : null}</div>
            <div className="asset-meta">
              <div className="asset-meta-header">
                <strong>{asset.asset_type}</strong>
                <div className="toolbar">
                  <button
                    className="small-icon-button"
                    onClick={() => onAddProfileReferenceToContext(asset.id)}
                    disabled={!activeContext || busy === `source-add-${asset.id}`}
                    title="Use as context source"
                    aria-label="Use as context source"
                  >
                    <ImagePlus size={14} aria-hidden />
                  </button>
                  <button
                    className="small-icon-button"
                    onClick={() => onDeleteReferenceAsset(asset.id)}
                    disabled={busy === `reference-delete-${asset.id}`}
                    title="Remove reference"
                    aria-label="Remove reference"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>
              <div>{asset.note || "No note"}</div>
            </div>
          </div>
        ))}
        {detail?.referenceAssets.length === 0 ? (
          <div className="status grid-status">Upload 3-8 reference images to make evaluator guidance stronger.</div>
        ) : null}
      </div>
    </section>
  );
}

interface CandidatePanelProps {
  currentCandidate: Candidate | null;
  candidateInputRef: RefObject<HTMLInputElement | null>;
  promptText: string;
  promptMissing: boolean;
  recoveryNote: string;
  generationTool: string;
  busy: string | null;
  onPromptTextChange: (value: string) => void;
  onPromptMissingChange: (value: boolean) => void;
  onRecoveryNoteChange: (value: string) => void;
  onGenerationToolChange: (value: string) => void;
  onUploadCandidate: (file: File) => void;
  onDeleteCurrentCandidate: () => void;
}

export function CandidatePanel({
  currentCandidate,
  candidateInputRef,
  promptText,
  promptMissing,
  recoveryNote,
  generationTool,
  busy,
  onPromptTextChange,
  onPromptMissingChange,
  onRecoveryNoteChange,
  onGenerationToolChange,
  onUploadCandidate,
  onDeleteCurrentCandidate
}: CandidatePanelProps) {
  return (
    <section className="panel" aria-labelledby="candidate-image-heading">
      <div className="panel-header">
        <h2 id="candidate-image-heading">Candidate image</h2>
        <div className="toolbar">
          {currentCandidate ? (
            <button
              className="button secondary icon-button danger-outline"
              onClick={onDeleteCurrentCandidate}
              disabled={busy === "candidate-delete"}
              title="Remove candidate"
              aria-label="Remove candidate"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          ) : null}
          <button
            className="button secondary icon-button"
            onClick={() => candidateInputRef.current?.click()}
            aria-label="Upload candidate image"
            title="Upload candidate image"
          >
            <ImagePlus size={16} aria-hidden />
          </button>
        </div>
      </div>
      <input
        className="hidden-input"
        data-testid="candidate-file-input"
        ref={candidateInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onUploadCandidate(file);
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
        <label className="field-label" htmlFor="candidate-prompt">
          Candidate prompt
        </label>
        <textarea
          id="candidate-prompt"
          className="textarea"
          value={promptText}
          onChange={(event) => {
            onPromptTextChange(event.target.value);
            if (event.target.value.trim()) {
              onPromptMissingChange(false);
            }
          }}
          placeholder="Prompt used to generate this candidate"
        />
        <div className="form-row">
          <input
            className="input"
            value={generationTool}
            onChange={(event) => onGenerationToolChange(event.target.value)}
            placeholder="Generation tool"
            aria-label="Candidate generation tool"
          />
          <label className="toggle-row">
            <input type="checkbox" checked={promptMissing} onChange={(event) => onPromptMissingChange(event.target.checked)} />
            Prompt missing
          </label>
        </div>
        {promptMissing ? (
          <>
            <label className="field-label" htmlFor="recovery-note">
              Recovery note
            </label>
            <textarea
              id="recovery-note"
              className="textarea"
              value={recoveryNote}
              onChange={(event) => onRecoveryNoteChange(event.target.value)}
              placeholder="What do you remember about the generation intent?"
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

interface HistoryPanelProps {
  history: HistoryItem[];
  savedEvaluationCount: number;
  onSelectCandidate: (candidate: Candidate) => void;
}

export function HistoryPanel({ history, savedEvaluationCount, onSelectCandidate }: HistoryPanelProps) {
  return (
    <section className="panel" aria-labelledby="history-heading">
      <div className="panel-header">
        <h2 id="history-heading">History</h2>
        <span className="microcopy">{savedEvaluationCount} saved judgments</span>
      </div>
      <div className="history-list" style={{ marginTop: 12 }}>
        {history.map((item) => {
          const evaluation = item.evaluations[0];
          return (
            <button className="history-item" key={item.candidate.id} onClick={() => onSelectCandidate(item.candidate)}>
              <strong>{item.generationContext.name}</strong>
              <span>
                {evaluation ? (
                  <>
                    <span className={`decision-${evaluation.decision_label}`}>{evaluation.decision_label}</span> · {evaluation.fit_score} ·{" "}
                    {evaluation.confidence_state}
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
  );
}

interface JudgmentPanelProps {
  status: WorkspaceStatus | null;
  activeContext: GenerationContext | null;
  activeEvaluation: Evaluation | undefined;
  activeCriteria: Criterion[];
  draft: Draft | null;
  currentCandidate: Candidate | null;
  busy: string | null;
  decisionLabel: DecisionLabel;
  humanReason: string;
  guidanceText: string;
  onEvaluateCandidate: () => void;
  onDecisionLabelChange: (value: DecisionLabel) => void;
  onHumanReasonChange: (value: string) => void;
  onGuidanceTextChange: (value: string) => void;
  onCopyGuidance: () => void;
  onSaveJudgment: () => void;
}

export function JudgmentPanel({
  status,
  activeContext,
  activeEvaluation,
  activeCriteria,
  draft,
  currentCandidate,
  busy,
  decisionLabel,
  humanReason,
  guidanceText,
  onEvaluateCandidate,
  onDecisionLabelChange,
  onHumanReasonChange,
  onGuidanceTextChange,
  onCopyGuidance,
  onSaveJudgment
}: JudgmentPanelProps) {
  return (
    <aside className="inspector" aria-label="Judgment inspector">
      <div className="stack">
        <div className="panel-header">
          <h2>Judgment</h2>
          <Sparkles size={18} aria-hidden />
        </div>

        {status ? <div className={`status ${status.kind === "info" ? "" : status.kind}`}>{status.text}</div> : null}

        {activeContext && activeContext.reference_strength !== "strong" ? (
          <div className="warning">Weak context source set: add source assets or prompt details for stronger evaluator guidance.</div>
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

        <button className="button" onClick={onEvaluateCandidate} disabled={!currentCandidate || busy === "evaluate"}>
          {busy === "evaluate" ? <Loader2 size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
          Evaluate candidate
        </button>

        {draft?.weak_reference_set ? <div className="warning">Evaluation allowed, but marked weak because fewer than 3 references exist.</div> : null}

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
            onChange={(event) => onDecisionLabelChange(event.target.value as DecisionLabel)}
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
            onChange={(event) => onHumanReasonChange(event.target.value)}
            placeholder="Why is this usable, fixable, or wrong for this playable?"
          />

          <label className="section-title" htmlFor="guidance">
            Next prompt guidance
          </label>
          <textarea
            id="guidance"
            className="textarea"
            value={guidanceText}
            onChange={(event) => onGuidanceTextChange(event.target.value)}
            placeholder="Reusable guidance for the next generation"
          />

          <div className="form-row">
            <button className="button secondary" onClick={onCopyGuidance} disabled={!guidanceText.trim()}>
              <Copy size={16} aria-hidden /> Copy
            </button>
            <button className="button" onClick={onSaveJudgment} disabled={!currentCandidate || busy === "save"}>
              <Save size={16} aria-hidden /> Save
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
