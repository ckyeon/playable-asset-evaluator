"use client";

import {
  Clipboard,
  Copy,
  Download,
  FileImage,
  ImagePlus,
  Loader2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import type {
  Candidate,
  Criterion,
  DecisionLabel,
  Draft,
  Evaluation,
  GenerationContext,
  HistoryItem,
  ProfileDetail,
  PromptRevision,
  RevisionUploadMode,
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

interface PromptRevisionStripProps {
  activeContext: GenerationContext | null;
  selectedPromptRevisionId: string | null;
  onSelectRevision: (revisionId: string) => void;
}

interface RevisionTreeRow {
  revision: PromptRevision;
  depth: number;
}

interface RevisionTree {
  revisionById: Map<string, PromptRevision>;
  childrenByParent: Map<string, PromptRevision[]>;
  orderedRows: RevisionTreeRow[];
  depthById: Map<string, number>;
}

const rootParentKey = "__root__";

export function PromptRevisionStrip({ activeContext, selectedPromptRevisionId, onSelectRevision }: PromptRevisionStripProps) {
  const [focusedRevisionId, setFocusedRevisionId] = useState<string | null>(null);
  const [openParametersId, setOpenParametersId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const revisions = useMemo(() => sortPromptRevisions(activeContext?.promptRevisions || []), [activeContext?.promptRevisions]);
  const tree = useMemo(() => buildRevisionTree(revisions), [revisions]);
  const selectedRevisionId =
    selectedPromptRevisionId && tree.revisionById.has(selectedPromptRevisionId) ? selectedPromptRevisionId : null;
  const selectedRevision = selectedRevisionId ? tree.revisionById.get(selectedRevisionId) || null : null;
  const compactRevision = selectedRevision || revisions[0] || null;
  const visibleRows = useMemo(() => buildVisibleRevisionRows(tree, selectedRevisionId), [tree, selectedRevisionId]);
  const deeperCount = selectedRevisionId ? countDeeperDescendants(selectedRevisionId, tree.childrenByParent, 2) : 0;

  function focusRow(revisionId: string, mode: "wide" | "compact") {
    setFocusedRevisionId(revisionId);
    rowRefs.current.get(`${mode}:${revisionId}`)?.focus();
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    row: RevisionTreeRow,
    rows: RevisionTreeRow[],
    mode: "wide" | "compact"
  ) {
    const currentIndex = rows.findIndex((item) => item.revision.id === row.revision.id);
    if (currentIndex < 0) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
      focusRow(rows[nextIndex].revision.id, mode);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : rows.length - 1;
      focusRow(rows[nextIndex].revision.id, mode);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectRevision(row.revision.id);
    }
  }

  function renderRevisionRow(row: RevisionTreeRow, rows: RevisionTreeRow[], mode: "wide" | "compact") {
    const revision = row.revision;
    const isSelected = revision.id === selectedRevisionId;
    const isFocused = focusedRevisionId ? revision.id === focusedRevisionId : isSelected || rows[0]?.revision.id === revision.id;
    const parameterId = `prompt-revision-parameters-${revision.id}`;
    const hasParameters = Boolean(revision.parameters_json);
    const parametersOpen = openParametersId === revision.id;

    return (
      <div className="prompt-revision-row-shell" key={`${mode}-${revision.id}`}>
        <div
          className={`prompt-revision-row ${isSelected ? "is-selected" : ""}`}
          data-testid="prompt-revision-row"
          ref={(node) => {
            const key = `${mode}:${revision.id}`;
            if (node) {
              rowRefs.current.set(key, node);
            } else {
              rowRefs.current.delete(key);
            }
          }}
          role="option"
          aria-selected={isSelected}
          aria-current={isSelected ? "true" : undefined}
          tabIndex={isFocused ? 0 : -1}
          onClick={() => onSelectRevision(revision.id)}
          onFocus={() => setFocusedRevisionId(revision.id)}
          onKeyDown={(event) => handleRowKeyDown(event, row, rows, mode)}
        >
          <span className="revision-branch" style={{ paddingLeft: `${Math.min(row.depth, 2) * 12}px` }} aria-hidden>
            {row.depth > 0 ? "|" : ""}
          </span>
          <span className="revision-title">
            <strong>{revisionTitle(revision)}</strong>
            <span>{parentSummary(revision, tree.revisionById)}</span>
          </span>
          <span className={effectivenessClassName(revision)} title={revision.effectiveness_reason.replaceAll("_", " ")}>
            {revision.effectiveness}
          </span>
          <span className="revision-count">{candidateCountLabel(revision.candidate_count)}</span>
          <span className="revision-preview">{promptPreview(revision.prompt_text)}</span>
          {hasParameters ? (
            <button
              className="revision-parameters-toggle"
              type="button"
              aria-expanded={parametersOpen}
              aria-controls={parameterId}
              onClick={(event) => {
                event.stopPropagation();
                setOpenParametersId(parametersOpen ? null : revision.id);
              }}
            >
              <SlidersHorizontal size={13} aria-hidden /> Parameters
            </button>
          ) : (
            <span className="revision-parameters-empty" aria-hidden />
          )}
        </div>
        {hasParameters && parametersOpen ? (
          <pre className="revision-parameters" id={parameterId}>
            {formatParameters(revision.parameters_json)}
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <section className="panel prompt-revision-strip" aria-labelledby="prompt-revisions-heading">
      <div className="panel-header">
        <div>
          <h2 id="prompt-revisions-heading">Prompt revisions</h2>
          <div className="microcopy">
            {activeContext ? `${revisions.length} revisions in ${activeContext.name}` : "Select a context to see prompt lineage."}
          </div>
        </div>
      </div>

      {!activeContext ? <div className="status compact-status prompt-revision-empty">Select a generation context first.</div> : null}
      {activeContext && revisions.length === 0 ? (
        <div className="status compact-status prompt-revision-empty">No prompt revisions yet.</div>
      ) : null}
      {activeContext && compactRevision ? (
        <>
          <div className="prompt-revision-compact" role="listbox" aria-label="Prompt revisions">
            {renderRevisionRow(
              { revision: compactRevision, depth: tree.depthById.get(compactRevision.id) || 0 },
              [{ revision: compactRevision, depth: tree.depthById.get(compactRevision.id) || 0 }],
              "compact"
            )}
            <div className="microcopy prompt-revision-related">
              {Math.max(0, revisions.length - 1)} related revisions hidden at this width.
            </div>
          </div>
          <div className="prompt-revision-list prompt-revision-list--wide" role="listbox" aria-label="Prompt revisions">
            {visibleRows.map((row) => renderRevisionRow(row, visibleRows, "wide"))}
            {deeperCount > 0 ? <div className="prompt-revision-more">+{deeperCount} deeper revisions</div> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function sortPromptRevisions(revisions: PromptRevision[]): PromptRevision[] {
  return [...revisions].sort((left, right) => {
    const createdDiff = left.created_at.localeCompare(right.created_at);
    return createdDiff || left.id.localeCompare(right.id);
  });
}

function buildRevisionTree(revisions: PromptRevision[]): RevisionTree {
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const childrenByParent = new Map<string, PromptRevision[]>();
  const orderedRows: RevisionTreeRow[] = [];
  const depthById = new Map<string, number>();

  for (const revision of revisions) {
    const parentKey =
      revision.parent_prompt_revision_id && revisionById.has(revision.parent_prompt_revision_id)
        ? revision.parent_prompt_revision_id
        : rootParentKey;
    const siblings = childrenByParent.get(parentKey) || [];
    siblings.push(revision);
    childrenByParent.set(parentKey, siblings);
  }

  const visit = (revision: PromptRevision, depth: number, seen: Set<string>) => {
    if (seen.has(revision.id)) {
      return;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(revision.id);
    orderedRows.push({ revision, depth });
    depthById.set(revision.id, depth);
    for (const child of childrenByParent.get(revision.id) || []) {
      visit(child, depth + 1, nextSeen);
    }
  };

  for (const root of childrenByParent.get(rootParentKey) || []) {
    visit(root, 0, new Set());
  }

  return { revisionById, childrenByParent, orderedRows, depthById };
}

function buildVisibleRevisionRows(tree: RevisionTree, selectedRevisionId: string | null): RevisionTreeRow[] {
  if (!selectedRevisionId) {
    return tree.orderedRows.slice(0, 8);
  }
  const selected = tree.revisionById.get(selectedRevisionId);
  if (!selected) {
    return tree.orderedRows.slice(0, 8);
  }

  const included = new Set<string>([selected.id]);
  for (const ancestorId of ancestorIds(selected, tree.revisionById)) {
    included.add(ancestorId);
  }

  const parentKey =
    selected.parent_prompt_revision_id && tree.revisionById.has(selected.parent_prompt_revision_id)
      ? selected.parent_prompt_revision_id
      : rootParentKey;
  for (const sibling of tree.childrenByParent.get(parentKey) || []) {
    included.add(sibling.id);
  }

  addDescendantsWithinDepth(selected.id, tree.childrenByParent, 2, included);
  return tree.orderedRows.filter((row) => included.has(row.revision.id));
}

function ancestorIds(revision: PromptRevision, revisionById: Map<string, PromptRevision>): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>([revision.id]);
  let parentId = revision.parent_prompt_revision_id;
  while (parentId && revisionById.has(parentId) && !seen.has(parentId)) {
    ancestors.push(parentId);
    seen.add(parentId);
    parentId = revisionById.get(parentId)?.parent_prompt_revision_id || null;
  }
  return ancestors;
}

function addDescendantsWithinDepth(
  revisionId: string,
  childrenByParent: Map<string, PromptRevision[]>,
  maxDepth: number,
  included: Set<string>,
  currentDepth = 1
) {
  if (currentDepth > maxDepth) {
    return;
  }
  for (const child of childrenByParent.get(revisionId) || []) {
    included.add(child.id);
    addDescendantsWithinDepth(child.id, childrenByParent, maxDepth, included, currentDepth + 1);
  }
}

function countDeeperDescendants(revisionId: string, childrenByParent: Map<string, PromptRevision[]>, maxVisibleDepth: number): number {
  let count = 0;
  const visit = (currentId: string, depth: number) => {
    for (const child of childrenByParent.get(currentId) || []) {
      if (depth > maxVisibleDepth) {
        count += 1;
      }
      visit(child.id, depth + 1);
    }
  };
  visit(revisionId, 1);
  return count;
}

function revisionTitle(revision: PromptRevision): string {
  return revision.revision_label?.trim() || `rev ${revision.id.slice(0, 8)}`;
}

function revisionOptionLabel(revision: PromptRevision): string {
  return `${revisionTitle(revision)} · ${revision.candidate_count} candidate${revision.candidate_count === 1 ? "" : "s"}`;
}

function parentSummary(revision: PromptRevision, revisionById: Map<string, PromptRevision>): string {
  if (!revision.parent_prompt_revision_id) {
    return "root";
  }
  const parent = revisionById.get(revision.parent_prompt_revision_id);
  return parent ? `child of ${revisionTitle(parent)}` : "missing parent";
}

function effectivenessClassName(revision: PromptRevision): string {
  const unknownWarning = revision.effectiveness === "unknown" && revision.effectiveness_reason === "broken_lineage";
  return `revision-effectiveness revision-effectiveness--${unknownWarning ? "unknown-warning" : revision.effectiveness}`;
}

function candidateCountLabel(count: number): string {
  return `${count} candidate${count === 1 ? "" : "s"}`;
}

function promptPreview(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function formatParameters(parametersJson: string | null): string {
  if (!parametersJson) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(parametersJson), null, 2);
  } catch {
    return parametersJson;
  }
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
  promptRevisions: PromptRevision[];
  selectedPromptRevisionId: string | null;
  revisionUploadMode: RevisionUploadMode;
  parentPromptRevisionId: string | null;
  attachPromptRevisionId: string | null;
  revisionLabel: string;
  revisionNote: string;
  negativePrompt: string;
  parametersJson: string;
  busy: string | null;
  onPromptTextChange: (value: string) => void;
  onPromptMissingChange: (value: boolean) => void;
  onRecoveryNoteChange: (value: string) => void;
  onGenerationToolChange: (value: string) => void;
  onRevisionUploadModeChange: (value: RevisionUploadMode) => void;
  onParentPromptRevisionIdChange: (value: string | null) => void;
  onAttachPromptRevisionIdChange: (value: string | null) => void;
  onRevisionLabelChange: (value: string) => void;
  onRevisionNoteChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onParametersJsonChange: (value: string) => void;
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
  promptRevisions,
  selectedPromptRevisionId,
  revisionUploadMode,
  parentPromptRevisionId,
  attachPromptRevisionId,
  revisionLabel,
  revisionNote,
  negativePrompt,
  parametersJson,
  busy,
  onPromptTextChange,
  onPromptMissingChange,
  onRecoveryNoteChange,
  onGenerationToolChange,
  onRevisionUploadModeChange,
  onParentPromptRevisionIdChange,
  onAttachPromptRevisionIdChange,
  onRevisionLabelChange,
  onRevisionNoteChange,
  onNegativePromptChange,
  onParametersJsonChange,
  onUploadCandidate,
  onDeleteCurrentCandidate
}: CandidatePanelProps) {
  const orderedRevisions = sortPromptRevisions(promptRevisions);
  const hasRevisions = orderedRevisions.length > 0;
  const targetAttachRevision =
    orderedRevisions.find((revision) => revision.id === attachPromptRevisionId) ||
    orderedRevisions.find((revision) => revision.id === selectedPromptRevisionId) ||
    orderedRevisions[0] ||
    null;
  const targetParentRevision =
    orderedRevisions.find((revision) => revision.id === parentPromptRevisionId) ||
    orderedRevisions.find((revision) => revision.id === selectedPromptRevisionId) ||
    orderedRevisions[0] ||
    null;
  const isAttachMode = revisionUploadMode === "attach_existing" && !promptMissing;
  const displayedPromptText = isAttachMode ? targetAttachRevision?.prompt_text || "" : promptText;

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
          className={`textarea ${isAttachMode ? "textarea-readonly" : ""}`}
          value={displayedPromptText}
          readOnly={isAttachMode}
          onChange={(event) => {
            if (isAttachMode) {
              return;
            }
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
        <fieldset className={`lineage-controls ${promptMissing ? "is-disabled" : ""}`} disabled={promptMissing}>
          <legend className="field-label">Prompt lineage</legend>
          <div className="segmented-control" aria-label="Prompt lineage mode">
            <button
              className={`segment-button ${revisionUploadMode === "new_root" ? "is-active" : ""}`}
              type="button"
              onClick={() => onRevisionUploadModeChange("new_root")}
            >
              New root
            </button>
            <button
              className={`segment-button ${revisionUploadMode === "new_child" ? "is-active" : ""}`}
              type="button"
              disabled={!hasRevisions}
              onClick={() => onRevisionUploadModeChange("new_child")}
            >
              New child
            </button>
            <button
              className={`segment-button ${revisionUploadMode === "attach_existing" ? "is-active" : ""}`}
              type="button"
              disabled={!hasRevisions}
              onClick={() => onRevisionUploadModeChange("attach_existing")}
            >
              Attach existing
            </button>
          </div>

          {revisionUploadMode === "new_child" ? (
            <label className="lineage-select-row">
              <span className="field-label">Parent revision</span>
              <select
                className="select"
                value={targetParentRevision?.id || ""}
                disabled={!hasRevisions}
                onChange={(event) => onParentPromptRevisionIdChange(event.target.value || null)}
              >
                {orderedRevisions.map((revision) => (
                  <option value={revision.id} key={revision.id}>
                    {revisionOptionLabel(revision)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {revisionUploadMode === "attach_existing" ? (
            <>
              <label className="lineage-select-row">
                <span className="field-label">Attach revision</span>
                <select
                  className="select"
                  value={targetAttachRevision?.id || ""}
                  disabled={!hasRevisions}
                  onChange={(event) => onAttachPromptRevisionIdChange(event.target.value || null)}
                >
                  {orderedRevisions.map((revision) => (
                    <option value={revision.id} key={revision.id}>
                      {revisionOptionLabel(revision)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="lineage-preview">{targetAttachRevision ? promptPreview(targetAttachRevision.prompt_text) : "No revision"}</div>
            </>
          ) : null}

          {revisionUploadMode !== "attach_existing" ? (
            <details className="lineage-advanced">
              <summary>Revision metadata</summary>
              <div className="form-row">
                <input
                  className="input"
                  value={revisionLabel}
                  onChange={(event) => onRevisionLabelChange(event.target.value)}
                  placeholder="Revision label"
                  aria-label="Revision label"
                />
                <input
                  className="input"
                  value={negativePrompt}
                  onChange={(event) => onNegativePromptChange(event.target.value)}
                  placeholder="Negative prompt"
                  aria-label="Negative prompt"
                />
              </div>
              <textarea
                className="textarea compact-textarea"
                value={revisionNote}
                onChange={(event) => onRevisionNoteChange(event.target.value)}
                placeholder="Revision note"
                aria-label="Revision note"
              />
              <textarea
                className="textarea compact-textarea mono-textarea"
                value={parametersJson}
                onChange={(event) => onParametersJsonChange(event.target.value)}
                placeholder='{"seed": 12, "steps": 20}'
                aria-label="Parameters JSON"
              />
            </details>
          ) : null}
        </fieldset>
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
