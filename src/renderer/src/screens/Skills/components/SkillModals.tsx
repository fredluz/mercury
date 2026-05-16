import type React from "react";
import { X } from "../../../assets/icons";
import type { SkillMarkdownImportRequest } from "../../../../../shared/skills";

interface SkillModalsProps {
  values: {
    t: (key: string, options?: Record<string, unknown>) => string;
    importOpen: boolean;
    setImportOpen: (open: boolean) => void;
    importName: string;
    setImportName: (value: string) => void;
    importCategory: string;
    setImportCategory: (value: string) => void;
    importDescription: string;
    setImportDescription: (value: string) => void;
    importMarkdown: string;
    setImportMarkdown: (value: string) => void;
    importOverwrite: boolean;
    setImportOverwrite: (value: boolean) => void;
    importing: boolean;
    importError: string;
    setImportError: (value: string) => void;
    handleImportMarkdown: () => Promise<void>;
  };
}

export type SkillImportModalRequest = SkillMarkdownImportRequest;

export function SkillModals({ values }: SkillModalsProps): React.JSX.Element | null {
  const {
    t,
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

  if (!importOpen) return null;

  return (
    <div
      className="skills-detail-overlay"
      onClick={() => {
        setImportError("");
        setImportOpen(false);
      }}
    >
      <div className="skills-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="skills-detail-header">
          <div>
            <div className="skills-detail-name">{t("skills.importTitle")}</div>
            <div className="skills-import-help">{t("skills.importHelp")}</div>
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
  );
}
