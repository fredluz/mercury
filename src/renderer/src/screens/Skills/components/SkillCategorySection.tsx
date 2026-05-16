import type React from "react";
import { ChevronDown, Download, Trash } from "../../../assets/icons";

export interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

export type SkillListItem =
  | {
      source: "installed";
      name: string;
      category: string;
      description: string;
      path: string;
      enabled: true;
      installedSkill: InstalledSkill;
    }
  | {
      source: "bundled";
      name: string;
      category: string;
      description: string;
      sourceLabel: string;
      enabled: boolean;
      installedSkill?: InstalledSkill;
    };

interface SkillCategorySectionProps {
  category: string;
  skills: SkillListItem[];
  collapsed: boolean;
  enabledCount: number;
  totalCount: number;
  actionInProgress: string | null;
  bulkActionInProgress: string | null;
  selectedKey: string | null;
  onToggleCollapsed: (category: string) => void;
  onOpenDetail: (skill: SkillListItem) => void;
  onEnableSkill: (skill: SkillListItem) => void;
  onDisableSkill: (skill: SkillListItem) => void;
  onEnableCategory: (category: string, skills: SkillListItem[]) => void;
  onDisableCategory: (category: string, skills: SkillListItem[]) => void;
  skillKey: (skill: { category: string; name: string }) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function SkillCategorySection({
  category,
  skills,
  collapsed,
  enabledCount,
  totalCount,
  actionInProgress,
  bulkActionInProgress,
  selectedKey,
  onToggleCollapsed,
  onOpenDetail,
  onEnableSkill,
  onDisableSkill,
  onEnableCategory,
  onDisableCategory,
  skillKey,
  t,
}: SkillCategorySectionProps): React.JSX.Element {
  const isBulkWorking = bulkActionInProgress?.startsWith(`${category}:`) ?? false;
  const hasDisabled = enabledCount < totalCount;
  const hasEnabled = enabledCount > 0;

  return (
    <section className="skills-category-section">
      <div className="skills-category-header">
        <button
          className="skills-category-toggle"
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("skills.showCategory") : t("skills.hideCategory")}
          onClick={() => onToggleCollapsed(category)}
        >
          <ChevronDown
            size={16}
            className={collapsed ? "skills-category-chevron collapsed" : "skills-category-chevron"}
          />
          <span className="skills-category-title">{category || t("skills.uncategorized")}</span>
          <span className="skills-category-count">
            {t("skills.categoryEnabledCount", { enabled: enabledCount, total: totalCount })}
          </span>
        </button>
        <div className="skills-category-actions">
          {hasDisabled && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={isBulkWorking}
              onClick={() => onEnableCategory(category, skills)}
            >
              {t("skills.enableAll")}
            </button>
          )}
          {hasEnabled && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={isBulkWorking}
              onClick={() => onDisableCategory(category, skills)}
            >
              {hasDisabled ? t("skills.disableEnabled") : t("skills.disableAll")}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="skills-category-body">
          {skills.map((skill) => {
            const key = skillKey(skill);
            const isActioning = actionInProgress === key;
            const canViewDetails = Boolean(skill.installedSkill);
            return (
              <div
                key={key}
                className={`skills-row ${selectedKey === key ? "skills-row-selected" : ""}`}
              >
                <div className="skills-row-main">
                  <div className="skills-row-titleline">
                    <div className="skills-card-name">{skill.name}</div>
                    <span
                      className={skill.enabled ? "skills-badge-enabled" : "skills-badge-disabled"}
                    >
                      {skill.enabled ? t("skills.enabledBadge") : t("skills.disabledBadge")}
                    </span>
                  </div>
                  {skill.description && (
                    <div className="skills-card-description">{skill.description}</div>
                  )}
                  {!canViewDetails && (
                    <div className="skills-row-note">
                      {t("skills.detailUnavailableForBundled")}
                    </div>
                  )}
                </div>
                <div className="skills-row-actions">
                  {canViewDetails && (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => onOpenDetail(skill)}
                    >
                      {t("skills.details")}
                    </button>
                  )}
                  {skill.enabled ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={isActioning || isBulkWorking}
                      onClick={() => onDisableSkill(skill)}
                    >
                      {isActioning ? (
                        t("skills.removing")
                      ) : (
                        <>
                          <Trash size={13} />
                          {t("skills.disable")}
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      disabled={isActioning || isBulkWorking}
                      onClick={() => onEnableSkill(skill)}
                    >
                      {isActioning ? (
                        t("skills.installing")
                      ) : (
                        <>
                          <Download size={13} />
                          {t("skills.enable")}
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
