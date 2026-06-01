import type React from "react";
import { X } from "../../../assets/icons";
import type { SkillMarkdownImportRequest, SkillSourceCandidate } from "../../../../../shared/skills";

type AddSkillMode = "markdown" | "github" | "command";

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

export function SkillModals({ values }: SkillModalsProps): React.JSX.Element | null {
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

  const sourceMode = importMode !== "markdown";
  const selectedCandidate =
    sourceCandidates.length === 1
      ? sourceCandidates[0]
      : sourceCandidates.find((candidate) => candidate.candidateId === selectedSourceCandidateId);
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
                <textarea
                  className="skills-import-textarea skills-source-input"
                  value={importSource}
                  onChange={(e) => setImportSource(e.target.value)}
                  placeholder={sourcePlaceholder(importMode, t)}
                />
              </label>
              <div className="skills-preview-row skills-import-field-wide">
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={handlePreviewSkillSource}
                  disabled={previewingSource || importing || !importSource.trim()}
                >
                  {previewingSource ? t("skills.previewingSource") : t("skills.previewSource")}
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
                    : t("skills.previewSourceHint")}
                </span>
              </div>
              {sourcePreviewed && sourceCandidates.length > 1 && (
                <div className="skills-candidate-picker skills-import-field-wide">
                  <div className="skills-candidate-title">{t("skills.chooseCandidate")}</div>
                  <div className="skills-candidate-list">
                    {sourceCandidates.map((candidate) => (
                      <button
                        className={`skills-candidate-item ${selectedSourceCandidateId === candidate.candidateId ? "selected" : ""}`}
                        type="button"
                        key={candidate.candidateId}
                        onClick={() => handleSourceCandidateSelection(candidate.candidateId)}
                        disabled={!candidate.valid}
                      >
                        <span className="skills-candidate-main">
                          <span className="skills-candidate-name">
                            {candidate.category}/{candidate.directoryName || candidate.name}
                          </span>
                          <span className="skills-candidate-path">{candidate.skillPath}</span>
                        </span>
                        <span className="skills-candidate-description">
                          {candidate.error || candidate.description || t("skills.noCandidateDescription")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {sourcePreviewed && sourceCandidates.length > 1 && !selectedSourceCandidateId && (
                <div className="skills-validation-text skills-import-field-wide">
                  {t("skills.candidateRequired")}
                </div>
              )}
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
            <input
              className="skills-search-input"
              list="skills-import-category-options"
              value={importCategory}
              onChange={(e) => setImportCategory(e.target.value)}
              placeholder="custom"
            />
            <datalist id="skills-import-category-options">
              {importCategoryOptions.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
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
