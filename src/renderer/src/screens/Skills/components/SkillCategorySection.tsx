import type React from "react";
import { ChevronDown, Download, Trash } from "../../../assets/icons";

export interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
  directoryName: string;
}

type SkillListItemDraftState = {
  baseEnabled: boolean;
  enabled: boolean;
  pendingAction?: "install" | "uninstall";
};

export type SkillListItem =
  | ({
      source: "installed";
      name: string;
      category: string;
      description: string;
      path: string;
      directoryName: string;
      installedSkill: InstalledSkill;
    } & SkillListItemDraftState)
  | ({
      source: "bundled";
      name: string;
      category: string;
      description: string;
      sourceLabel: string;
      directoryName: string;
      installedSkill?: InstalledSkill;
    } & SkillListItemDraftState);

interface SkillCategorySectionProps {
  category: string;
  skills: SkillListItem[];
  collapsed: boolean;
  enabledCount: number;
  totalCount: number;
  pendingCount: number;
  saving: boolean;
  selectedKey: string | null;
  onToggleCollapsed: (category: string) => void;
  onOpenDetail: (skill: SkillListItem) => void;
  onEnableSkill: (skill: SkillListItem) => void;
  onDisableSkill: (skill: SkillListItem) => void;
  onUndoPendingChange: (skill: SkillListItem) => void;
  onEnableCategory: (category: string, skills: SkillListItem[]) => void;
  onDisableCategory: (category: string, skills: SkillListItem[]) => void;
  skillKey: (skill: SkillListItem) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function SkillCategorySection({
  category,
  skills,
  collapsed,
  enabledCount,
  totalCount,
  pendingCount,
  saving,
  selectedKey,
  onToggleCollapsed,
  onOpenDetail,
  onEnableSkill,
  onDisableSkill,
  onUndoPendingChange,
  onEnableCategory,
  onDisableCategory,
  skillKey,
  t,
}: SkillCategorySectionProps): React.JSX.Element {
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
          {pendingCount > 0 && (
            <span className="skills-category-pending">
              {t("skills.categoryPendingCount", { count: pendingCount })}
            </span>
          )}
        </button>
        <div className="skills-category-actions">
          {hasDisabled && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={saving}
              onClick={() => onEnableCategory(category, skills)}
            >
              {t("skills.enableAll")}
            </button>
          )}
          {hasEnabled && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={saving}
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
            const isPending = Boolean(skill.pendingAction);
            const canViewDetails = Boolean(skill.installedSkill) && skill.pendingAction !== "uninstall";
            const badgeClass = skill.pendingAction
              ? skill.pendingAction === "install"
                ? "skills-badge-pending-enable"
                : "skills-badge-pending-disable"
              : skill.enabled
                ? "skills-badge-enabled"
                : "skills-badge-disabled";
            const badgeText = skill.pendingAction
              ? skill.pendingAction === "install"
                ? t("skills.pendingEnableBadge")
                : t("skills.pendingDisableBadge")
              : skill.enabled
                ? t("skills.enabledBadge")
                : t("skills.disabledBadge");
            return (
              <div
                key={key}
                className={`skills-row ${selectedKey === key ? "skills-row-selected" : ""} ${
                  isPending ? "skills-row-pending" : ""
                }`}
              >
                <div className="skills-row-main">
                  <div className="skills-row-titleline">
                    <div className="skills-card-name">{skill.name}</div>
                    <span className={badgeClass}>{badgeText}</span>
                  </div>
                  {skill.description && (
                    <div className="skills-card-description">{skill.description}</div>
                  )}
                  {!skill.installedSkill && (
                    <div className="skills-row-note">
                      {t("skills.detailUnavailableForBundled")}
                    </div>
                  )}
                  {skill.pendingAction === "uninstall" && (
                    <div className="skills-row-note">
                      {t("skills.detailUnavailablePendingDisable")}
                    </div>
                  )}
                </div>
                <div className="skills-row-actions">
                  {canViewDetails && (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => onOpenDetail(skill)}
                      disabled={saving}
                    >
                      {t("skills.details")}
                    </button>
                  )}
                  {isPending ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={saving}
                      onClick={() => onUndoPendingChange(skill)}
                    >
                      {t("skills.undoPendingChange")}
                    </button>
                  ) : skill.enabled ? (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={saving}
                      onClick={() => onDisableSkill(skill)}
                    >
                      <Trash size={13} />
                      {t("skills.disable")}
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      disabled={saving}
                      onClick={() => onEnableSkill(skill)}
                    >
                      <Download size={13} />
                      {t("skills.enable")}
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
