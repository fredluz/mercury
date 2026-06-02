import { useState, type JSX } from "react";
import { ArrowLeft, ArrowRight, X } from "../../../assets/icons";
import type { SkillMarkdownImportRequest, SkillSourceCandidate } from "../../../../../shared/skills";

type AddSkillMode = "markdown" | "github" | "command";

const NEW_CATEGORY_SENTINEL = "__create_new_pack__";

interface SkillModalsProps {
  values: {
    t: (key: string, options?: Record<string, unknown>) => string;
    importOpen: boolean;
    setImportOpen: (open: boolean) => void;
    importMode: AddSkillMode;
    setImportMode: (mode: AddSkillMode) => void;
    remoteOnlyMode: boolean;
    sourceTabsAvailable: boolean;
    importName: string;
    setImportName: (value: string) => void;
    importCategory: string;
    setImportCategory: (value: string) => void;
    importCategoryOptions: string[];
    importDescription: string;
    setImportDescription: (value: string) => void;
    importMarkdown: string;
    setImportMarkdown: (value: string) => void;
    importSource: string;
    setImportSource: (value: string) => void;
    sourceCandidates: SkillSourceCandidate[];
    selectedSourceCandidateId: string;
    sourcePreviewed: boolean;
    previewingSource: boolean;
    importOverwrite: boolean;
    setImportOverwrite: (value: boolean) => void;
    importing: boolean;
    importError: string;
    setImportError: (value: string) => void;
    handleImportMarkdown: () => Promise<void>;
    handlePreviewSkillSource: () => Promise<void>;
    handleImportSkillSource: () => Promise<void>;
    handleSourceCandidateSelection: (candidateId: string) => void;
  };
}

export type SkillImportModalRequest = SkillMarkdownImportRequest;

function sourcePlaceholder(mode: AddSkillMode, t: (key: string) => string): string {
  if (mode === "command") return t("skills.sourceCommandPlaceholder");
  return t("skills.sourceUrlPlaceholder");
}

export function SkillModals({ values }: SkillModalsProps): JSX.Element | null {
  // Local toggle: when true, the Category control becomes a free-text input for
  // naming a brand-new skill pack instead of picking an existing one.
  const [creatingNewCategory, setCreatingNewCategory] = useState(false);
  const {
    t,
    importOpen,
    setImportOpen,
    importMode,
    setImportMode,
    remoteOnlyMode,
    sourceTabsAvailable,
    importName,
    setImportName,
    importCategory,
    setImportCategory,
    importCategoryOptions,
    importDescription,
    setImportDescription,
    importMarkdown,
    setImportMarkdown,
    importSource,
    setImportSource,
    sourceCandidates,
    selectedSourceCandidateId,
    sourcePreviewed,
    previewingSource,
    importOverwrite,
    setImportOverwrite,
    importing,
    importError,
    setImportError,
    handleImportMarkdown,
    handlePreviewSkillSource,
    handleImportSkillSource,
    handleSourceCandidateSelection,
  } = values;

  if (!importOpen) return null;

  // Existing skill packs the skill can be filed under, plus the current value so a
  // category resolved from a source candidate still renders as the selected option.
  const categorySelectOptions = Array.from(
    new Set([...importCategoryOptions, importCategory, "custom"].filter(Boolean)),
  );

  const sourceMode = importMode !== "markdown";
  const selectedCandidate =
    sourceCandidates.length === 1
      ? sourceCandidates[0]
      : sourceCandidates.find((candidate) => candidate.candidateId === selectedSourceCandidateId);
  const selectedIndex = selectedCandidate
    ? sourceCandidates.findIndex((candidate) => candidate.candidateId === selectedCandidate.candidateId)
    : -1;

  function stepCandidate(offset: number): void {
    if (sourceCandidates.length === 0) return;
    const base = selectedIndex < 0 ? 0 : selectedIndex;
    const next = (base + offset + sourceCandidates.length) % sourceCandidates.length;
    handleSourceCandidateSelection(sourceCandidates[next].candidateId);
  }
  const sourceImportDisabled =
    importing ||
    previewingSource ||
    !importSource.trim() ||
    !sourcePreviewed ||
    sourceCandidates.length === 0 ||
    (sourceCandidates.length > 1 && !selectedSourceCandidateId) ||
    Boolean(selectedCandidate && !selectedCandidate.valid);

  function closeModal(): void {
    setImportError("");
    setImportOpen(false);
  }

  return (
    <div className="skills-detail-overlay" onClick={closeModal}>
      <div className="skills-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="skills-detail-header">
          <div>
            <div className="skills-detail-name">{t("skills.addSkillTitle")}</div>
            <div className="skills-import-help">{t("skills.addSkillHelp")}</div>
          </div>
          <button className="btn-ghost" onClick={closeModal}>
            <X size={18} />
          </button>
        </div>
        {importError && (
          <div className="skills-error skills-import-error">
            {importError}
            <button className="btn-ghost" onClick={() => setImportError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="skills-import-form">
          <div className="skills-source-tabs" role="tablist" aria-label={t("skills.addSkillSourceTabs")}>
            <button
              className={`skills-source-tab ${importMode === "markdown" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={importMode === "markdown"}
              onClick={() => {
                setImportError("");
                setImportMode("markdown");
              }}
            >
              {t("skills.pasteMarkdownTab")}
            </button>
            {sourceTabsAvailable && (
              <>
                <button
                  className={`skills-source-tab ${importMode === "github" ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={importMode === "github"}
                  onClick={() => {
                    setImportError("");
                    setImportMode("github");
                  }}
                >
                  {t("skills.githubLinkTab")}
                </button>
                <button
                  className={`skills-source-tab ${importMode === "command" ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={importMode === "command"}
                  onClick={() => {
                    setImportError("");
                    setImportMode("command");
                  }}
                >
                  {t("skills.commandTab")}
                </button>
              </>
            )}
          </div>

          {remoteOnlyMode && (
            <div className="skills-validation-text skills-import-field-wide">
              {t("skills.sourceRemoteUnavailable")}
            </div>
          )}

          {sourceMode ? (
            <>
              <label className="skills-import-field skills-import-field-wide">
                <span>
                  {importMode === "command" ? t("skills.sourceCommand") : t("skills.sourceUrl")}
                </span>
                {importMode === "command" ? (
                  <textarea
                    className="skills-import-textarea skills-source-input"
                    value={importSource}
                    onChange={(e) => setImportSource(e.target.value)}
                    placeholder={sourcePlaceholder(importMode, t)}
                  />
                ) : (
                  <input
                    className="skills-search-input"
                    value={importSource}
                    onChange={(e) => setImportSource(e.target.value)}
                    placeholder={sourcePlaceholder(importMode, t)}
                  />
                )}
              </label>
              <div className="skills-preview-row skills-import-field-wide">
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={handlePreviewSkillSource}
                  disabled={previewingSource || importing || !importSource.trim()}
                >
                  {importMode === "command"
                    ? previewingSource
                      ? t("skills.previewingSource")
                      : t("skills.previewSource")
                    : previewingSource
                      ? t("skills.gettingSkills")
                      : t("skills.getSkills")}
                </button>
                <span className="skills-validation-text">
                  {sourcePreviewed
                    ? selectedCandidate && !selectedCandidate.valid
                      ? selectedCandidate.error || t("skills.sourcePreviewFailed")
                      : sourceCandidates.length === 1
                        ? t("skills.singleCandidateSummary", {
                            name: selectedCandidate
                              ? `${selectedCandidate.category}/${selectedCandidate.directoryName}`
                              : "",
                          })
                        : t("skills.candidateCount", { count: sourceCandidates.length })
                    : importMode === "command"
                      ? t("skills.previewSourceHint")
                      : t("skills.getSkillsHint")}
                </span>
              </div>
              {/* Read-only SKILL.md preview for the currently-selected candidate, with
                  arrows to page through repos that contain multiple skills. */}
              <div className="skills-import-field skills-import-field-wide">
                <div className="skills-source-preview-head">
                  <span>{t("skills.sourceSkillBody")}</span>
                  {sourcePreviewed && sourceCandidates.length > 0 && (
                    <div className="skills-source-preview-nav">
                      <button
                        className="btn-ghost"
                        type="button"
                        aria-label={t("skills.sourceCandidatePrev")}
                        onClick={() => stepCandidate(-1)}
                        disabled={sourceCandidates.length <= 1}
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <span className="skills-source-preview-position">
                        {t("skills.sourceCandidatePosition", {
                          position: selectedIndex < 0 ? 1 : selectedIndex + 1,
                          total: sourceCandidates.length,
                        })}
                      </span>
                      <button
                        className="btn-ghost"
                        type="button"
                        aria-label={t("skills.sourceCandidateNext")}
                        onClick={() => stepCandidate(1)}
                        disabled={sourceCandidates.length <= 1}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
                {selectedCandidate && (
                  <div className="skills-source-preview-meta">
                    {selectedCandidate.category}/{selectedCandidate.directoryName || selectedCandidate.name}
                    {" · "}
                    {selectedCandidate.skillPath}
                  </div>
                )}
                <textarea
                  className="skills-import-textarea skills-source-body"
                  readOnly
                  value={
                    selectedCandidate?.markdown ||
                    (selectedCandidate
                      ? t("skills.sourceSkillBodyUnavailable")
                      : t("skills.sourceSkillBodyEmpty"))
                  }
                  placeholder={t("skills.sourceSkillBodyEmpty")}
                />
              </div>
            </>
          ) : (
            <label className="skills-import-field skills-import-field-wide">
              <span>{t("skills.importMarkdown")}</span>
              <textarea
                className="skills-import-textarea"
                value={importMarkdown}
                onChange={(e) => setImportMarkdown(e.target.value)}
                placeholder={t("skills.importMarkdownPlaceholder")}
              />
            </label>
          )}

          <label className="skills-import-field">
            <span>{t("skills.importName")}</span>
            <input
              className="skills-search-input"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder={t("skills.importNamePlaceholder")}
            />
          </label>
          <label className="skills-import-field">
            <span>{t("skills.importCategory")}</span>
            {creatingNewCategory ? (
              <>
                <input
                  className="skills-search-input"
                  value={importCategory}
                  onChange={(e) => setImportCategory(e.target.value)}
                  placeholder={t("skills.importCategoryNewPlaceholder")}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-ghost skills-category-back"
                  onClick={() => {
                    setCreatingNewCategory(false);
                    setImportCategory(importCategoryOptions[0] ?? "custom");
                  }}
                >
                  {t("skills.importCategoryBack")}
                </button>
              </>
            ) : (
              <select
                className="skills-search-input"
                value={importCategory}
                onChange={(e) => {
                  if (e.target.value === NEW_CATEGORY_SENTINEL) {
                    setCreatingNewCategory(true);
                    setImportCategory("");
                    return;
                  }
                  setImportCategory(e.target.value);
                }}
              >
                {categorySelectOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
                <option value={NEW_CATEGORY_SENTINEL}>{t("skills.importCategoryNewOption")}</option>
              </select>
            )}
            <span className="skills-field-hint">{t("skills.importCategoryHint")}</span>
          </label>
          <label className="skills-import-field skills-import-field-wide">
            <span>{t("skills.importDescription")}</span>
            <input
              className="skills-search-input"
              value={importDescription}
              onChange={(e) => setImportDescription(e.target.value)}
              placeholder={t("skills.importDescriptionPlaceholder")}
            />
          </label>
          <label className="skills-import-overwrite">
            <input
              type="checkbox"
              checked={importOverwrite}
              onChange={(e) => setImportOverwrite(e.target.checked)}
            />
            <span>{t("skills.importOverwrite")}</span>
          </label>
        </div>
        <div className="skills-import-actions">
          <button className="btn btn-secondary btn-sm" onClick={closeModal} disabled={importing}>
            {t("skills.importCancel")}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={sourceMode ? handleImportSkillSource : handleImportMarkdown}
            disabled={sourceMode ? sourceImportDisabled : importing || !importMarkdown.trim()}
          >
            {importing ? t("skills.importing") : t("skills.import")}
          </button>
        </div>
      </div>
    </div>
  );
}
