import { useEffect, useRef, useState } from "react";
import { X } from "../../assets/icons";
import type {
  AgentSeedSkillPrepareRequest,
  AttachAgentSeedSkillResult,
} from "../../../../shared/agents";
import type { SkillSourceCandidate } from "../../../../shared/skills";
import { useI18n } from "../../components/useI18n";

type SeedSkillMode = "markdown" | "github" | "command";

interface AgentSeedSkillModalProps {
  remoteOnly: boolean;
  onAttach: (
    seed: AgentSeedSkillPrepareRequest,
  ) => Promise<AttachAgentSeedSkillResult>;
  onClose: () => void;
}

function sourcePlaceholder(
  mode: SeedSkillMode,
  t: (key: string) => string,
): string {
  if (mode === "command") return t("skills.sourceCommandPlaceholder");
  return t("skills.sourceUrlPlaceholder");
}

export function AgentSeedSkillModal({
  remoteOnly,
  onAttach,
  onClose,
}: AgentSeedSkillModalProps): React.JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<SeedSkillMode>("markdown");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("custom");
  const [description, setDescription] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [source, setSource] = useState("");
  const [candidates, setCandidates] = useState<SkillSourceCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [previewed, setPreviewed] = useState(false);
  const [previewedSource, setPreviewedSource] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const previewSeqRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = "agent-seed-skill-title";

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const sourceMode = mode !== "markdown";
  // A preview is only valid for the exact source text it was run against.
  const previewMatchesSource = previewed && previewedSource === source.trim();
  const selectedCandidate =
    candidates.length === 1
      ? candidates[0]
      : candidates.find(
          (candidate) => candidate.candidateId === selectedCandidateId,
        );
  const sourceAttachDisabled =
    submitting ||
    previewing ||
    !source.trim() ||
    !previewMatchesSource ||
    candidates.length === 0 ||
    (candidates.length > 1 && !selectedCandidateId) ||
    Boolean(selectedCandidate && !selectedCandidate.valid);

  function switchMode(next: SeedSkillMode): void {
    setError("");
    setMode(next);
  }

  function handleSourceChange(value: string): void {
    setSource(value);
    setCandidates([]);
    setSelectedCandidateId("");
    setPreviewed(false);
    setPreviewedSource("");
  }

  function handleCandidateSelection(candidateId: string): void {
    setSelectedCandidateId(candidateId);
    const candidate = candidates.find(
      (item) => item.candidateId === candidateId,
    );
    if (candidate) setCategory(candidate.category || "custom");
  }

  async function handlePreview(): Promise<void> {
    const trimmed = source.trim();
    if (!trimmed) return;
    const seq = ++previewSeqRef.current;
    setPreviewing(true);
    setPreviewed(false);
    setPreviewedSource("");
    setCandidates([]);
    setSelectedCandidateId("");
    setError("");
    try {
      const result = await window.hermesAPI.previewSkillSource({
        source: trimmed,
      });
      // Discard results from a superseded preview (source edited meanwhile).
      if (seq !== previewSeqRef.current) return;
      if (!result.success) {
        setError(result.error || t("skills.sourcePreviewFailed"));
        return;
      }
      setCandidates(result.candidates);
      setPreviewed(true);
      setPreviewedSource(trimmed);
      if (result.candidates.length === 1) {
        const [candidate] = result.candidates;
        setSelectedCandidateId(candidate.candidateId);
        setCategory(candidate.category || "custom");
      }
    } catch (err) {
      if (seq !== previewSeqRef.current) return;
      setError(
        err instanceof Error ? err.message : t("skills.sourcePreviewFailed"),
      );
    } finally {
      if (seq === previewSeqRef.current) setPreviewing(false);
    }
  }

  async function submit(seed: AgentSeedSkillPrepareRequest): Promise<void> {
    setSubmitting(true);
    setError("");
    try {
      const result = await onAttach(seed);
      if (result.success) {
        onClose();
        return;
      }
      if (result.code === "multiple-candidates" && result.candidates) {
        setCandidates(result.candidates);
        setPreviewed(true);
        setPreviewedSource(source.trim());
        setSelectedCandidateId("");
      }
      setError(result.error || t("agents.seedAttachFailed"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("agents.seedAttachFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAttachMarkdown(): Promise<void> {
    await submit({
      kind: "markdown",
      markdown,
      name: name.trim() || undefined,
      category: category.trim() || undefined,
      description: description.trim() || undefined,
      overwrite,
    });
  }

  async function handleAttachSource(): Promise<void> {
    const candidateId =
      candidates.length === 1
        ? candidates[0]?.candidateId
        : selectedCandidateId;
    await submit({
      kind: "source",
      source: source.trim(),
      candidateId: candidateId || undefined,
      name: name.trim() || undefined,
      category: category.trim() || undefined,
      description: description.trim() || undefined,
      overwrite,
    });
  }

  function closeModal(): void {
    if (submitting) return;
    setError("");
    onClose();
  }

  return (
    <div className="skills-detail-overlay" onClick={closeModal}>
      <div
        className="skills-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="skills-detail-header">
          <div>
            <div className="skills-detail-name" id={titleId}>
              {t("agents.seedModalTitle")}
            </div>
            <div className="skills-import-help">
              {t("agents.seedModalHelp")}
            </div>
          </div>
          <button
            className="btn-ghost"
            aria-label={t("agents.capabilitiesDrawerClose")}
            onClick={closeModal}
          >
            <X size={18} />
          </button>
        </div>
        {error ? (
          <div className="skills-error skills-import-error">
            {error}
            <button className="btn-ghost" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        ) : null}
        <div className="skills-import-form">
          <div
            className="skills-source-tabs"
            role="tablist"
            aria-label={t("agents.seedModalTitle")}
          >
            <button
              className={`skills-source-tab ${mode === "markdown" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={mode === "markdown"}
              onClick={() => switchMode("markdown")}
            >
              {t("skills.pasteMarkdownTab")}
            </button>
            {!remoteOnly ? (
              <>
                <button
                  className={`skills-source-tab ${mode === "github" ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={mode === "github"}
                  onClick={() => switchMode("github")}
                >
                  {t("skills.githubLinkTab")}
                </button>
                <button
                  className={`skills-source-tab ${mode === "command" ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={mode === "command"}
                  onClick={() => switchMode("command")}
                >
                  {t("skills.commandTab")}
                </button>
              </>
            ) : null}
          </div>

          {remoteOnly ? (
            <div className="skills-validation-text skills-import-field-wide">
              {t("agents.seedSourceRemoteUnavailable")}
            </div>
          ) : null}

          {sourceMode ? (
            <>
              <label className="skills-import-field skills-import-field-wide">
                <span>
                  {mode === "command"
                    ? t("skills.sourceCommand")
                    : t("skills.sourceUrl")}
                </span>
                <textarea
                  className="skills-import-textarea skills-source-input"
                  value={source}
                  onChange={(e) => handleSourceChange(e.target.value)}
                  placeholder={sourcePlaceholder(mode, t)}
                />
              </label>
              <div className="skills-preview-row skills-import-field-wide">
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => void handlePreview()}
                  disabled={previewing || submitting || !source.trim()}
                >
                  {previewing
                    ? t("skills.previewingSource")
                    : t("skills.previewSource")}
                </button>
                <span className="skills-validation-text">
                  {previewMatchesSource
                    ? selectedCandidate && !selectedCandidate.valid
                      ? selectedCandidate.error ||
                        t("skills.sourcePreviewFailed")
                      : candidates.length === 1
                        ? t("skills.singleCandidateSummary", {
                            name: selectedCandidate
                              ? `${selectedCandidate.category}/${selectedCandidate.directoryName}`
                              : "",
                          })
                        : t("skills.candidateCount", {
                            count: candidates.length,
                          })
                    : t("skills.previewSourceHint")}
                </span>
              </div>
              {previewMatchesSource && candidates.length > 1 ? (
                <div className="skills-candidate-picker skills-import-field-wide">
                  <div className="skills-candidate-title">
                    {t("skills.chooseCandidate")}
                  </div>
                  <div className="skills-candidate-list">
                    {candidates.map((candidate) => (
                      <button
                        className={`skills-candidate-item ${selectedCandidateId === candidate.candidateId ? "selected" : ""}`}
                        type="button"
                        key={candidate.candidateId}
                        onClick={() =>
                          handleCandidateSelection(candidate.candidateId)
                        }
                        disabled={!candidate.valid}
                      >
                        <span className="skills-candidate-main">
                          <span className="skills-candidate-name">
                            {candidate.category}/
                            {candidate.directoryName || candidate.name}
                          </span>
                          <span className="skills-candidate-path">
                            {candidate.skillPath}
                          </span>
                        </span>
                        <span className="skills-candidate-description">
                          {candidate.error ||
                            candidate.description ||
                            t("skills.noCandidateDescription")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {previewMatchesSource &&
              candidates.length > 1 &&
              !selectedCandidateId ? (
                <div className="skills-validation-text skills-import-field-wide">
                  {t("skills.candidateRequired")}
                </div>
              ) : null}
            </>
          ) : (
            <label className="skills-import-field skills-import-field-wide">
              <span>{t("skills.importMarkdown")}</span>
              <textarea
                className="skills-import-textarea"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                placeholder={t("skills.importMarkdownPlaceholder")}
              />
            </label>
          )}

          <label className="skills-import-field">
            <span>{t("skills.importName")}</span>
            <input
              className="skills-search-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("skills.importNamePlaceholder")}
            />
          </label>
          <label className="skills-import-field">
            <span>{t("skills.importCategory")}</span>
            <input
              className="skills-search-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="custom"
            />
            <span className="skills-field-hint">
              {t("skills.importCategoryHint")}
            </span>
          </label>
          <label className="skills-import-field skills-import-field-wide">
            <span>{t("skills.importDescription")}</span>
            <input
              className="skills-search-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("skills.importDescriptionPlaceholder")}
            />
          </label>
          <label className="skills-import-overwrite">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            <span>{t("skills.importOverwrite")}</span>
          </label>
        </div>
        <div className="skills-import-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={closeModal}
            disabled={submitting}
          >
            {t("skills.importCancel")}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              void (sourceMode ? handleAttachSource() : handleAttachMarkdown())
            }
            disabled={
              sourceMode ? sourceAttachDisabled : submitting || !markdown.trim()
            }
          >
            {submitting ? t("agents.seedAttaching") : t("agents.seedAttach")}
          </button>
        </div>
      </div>
    </div>
  );
}
