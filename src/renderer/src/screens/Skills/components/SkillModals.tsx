import type React from "react";
import { X, Trash } from "../../../assets/icons";
import { AgentMarkdown } from "../../../components/AgentMarkdown";

interface SkillModalsProps { values: any; }

export function SkillModals({ values }: SkillModalsProps): React.JSX.Element {
  const {
  t,
  detailSkill,
  setDetailSkill,
  detailContent,
  actionInProgress,
  handleUninstall,
  importOpen,
  setImportOpen,
  importName,
  setImportName,
  importCategory,
  setImportCategory,
  importDescription,
  setImportDescription,
  importMarkdown,
  setImportMarkdown,
  importOverwrite,
  setImportOverwrite,
  importing,
  importError,
  setImportError,
  handleImportMarkdown,
  } = values;
  return (
    <>
      {/* Detail Panel */}
      {detailSkill && (
        <div
          className="skills-detail-overlay"
          onClick={() => setDetailSkill(null)}
        >
          <div className="skills-detail" onClick={(e) => e.stopPropagation()}>
            <div className="skills-detail-header">
              <div>
                <div className="skills-detail-name">{detailSkill.name}</div>
                <div className="skills-detail-category">
                  {detailSkill.category}
                </div>
              </div>
              <div className="skills-detail-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleUninstall(detailSkill.name)}
                  disabled={actionInProgress === detailSkill.name}
                >
                  {actionInProgress === detailSkill.name ? (
                    t("skills.removing")
                  ) : (
                    <>
                      <Trash size={13} />
                      {t("skills.uninstall")}
                    </>
                  )}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => setDetailSkill(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="skills-detail-content">
              <AgentMarkdown>{detailContent}</AgentMarkdown>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div
          className="skills-detail-overlay"
          onClick={() => {
            setImportError("");
            setImportOpen(false);
          }}
        >
          <div
            className="skills-import-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="skills-detail-header">
              <div>
                <div className="skills-detail-name">
                  {t("skills.importTitle")}
                </div>
                <div className="skills-import-help">
                  {t("skills.importHelp")}
                </div>
              </div>
              <button
                className="btn-ghost"
                onClick={() => {
                  setImportError("");
                  setImportOpen(false);
                }}
              >
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
                  value={importCategory}
                  onChange={(e) => setImportCategory(e.target.value)}
                  placeholder="custom"
                />
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
              <label className="skills-import-field skills-import-field-wide">
                <span>{t("skills.importMarkdown")}</span>
                <textarea
                  className="skills-import-textarea"
                  value={importMarkdown}
                  onChange={(e) => setImportMarkdown(e.target.value)}
                  placeholder={t("skills.importMarkdownPlaceholder")}
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
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setImportError("");
                  setImportOpen(false);
                }}
                disabled={importing}
              >
                {t("skills.importCancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleImportMarkdown}
                disabled={importing || !importMarkdown.trim()}
              >
                {importing ? t("skills.importing") : t("skills.import")}
              </button>
            </div>
          </div>
        </div>
      )}


    </>
  );
}
