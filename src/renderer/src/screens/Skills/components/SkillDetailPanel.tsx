import type React from "react";
import { Trash, X } from "../../../assets/icons";
import { AgentMarkdown } from "../../../components/AgentMarkdown";
import type { SkillMetadata } from "../../../../../shared/skills";
import type { InstalledSkill } from "./SkillCategorySection";

export interface SkillAgentUsage {
  name: string;
  isSelected: boolean;
}

export interface SelectedSkillDetail {
  skill: InstalledSkill;
  markdown: string;
  markdownLoading: boolean;
  metadata: SkillMetadata | null;
  metadataLoading: boolean;
  agents: SkillAgentUsage[];
  agentsLoading: boolean;
  agentsUnavailable: boolean;
  error: string;
}

interface SkillDetailPanelProps {
  detail: SelectedSkillDetail;
  actionInProgress: string | null;
  onBack: () => void;
  onDisable: (skill: InstalledSkill) => void;
  skillKey: (skill: { category: string; name: string }) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function MetadataList({
  items,
  emptyText,
  directoryKind,
}: {
  items: Array<{ relativePath: string; kind: "file" | "directory" }>;
  emptyText: string;
  directoryKind: string;
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="skills-meta-empty">{emptyText}</div>;
  }

  return (
    <ul className="skills-meta-list">
      {items.map((item) => (
        <li key={item.relativePath}>
          <code>{item.relativePath}</code>
          {item.kind === "directory" && (
            <span className="skills-meta-kind">{directoryKind}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SkillDetailPanel({
  detail,
  actionInProgress,
  onBack,
  onDisable,
  skillKey,
  t,
}: SkillDetailPanelProps): React.JSX.Element {
  const key = skillKey(detail.skill);
  const metadata = detail.metadata;

  return (
    <div className="skills-detail-page">
      <div className="skills-detail-toolbar">
        <button className="btn btn-secondary btn-sm" type="button" onClick={onBack}>
          {t("skills.backToSkills")}
        </button>
        <div className="skills-detail-titleblock">
          <div className="skills-detail-name">{detail.skill.name}</div>
          <div className="skills-detail-category">{detail.skill.category}</div>
        </div>
        <div className="skills-detail-actions">
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => onDisable(detail.skill)}
            disabled={actionInProgress === key}
          >
            {actionInProgress === key ? (
              t("skills.removing")
            ) : (
              <>
                <Trash size={13} />
                {t("skills.disable")}
              </>
            )}
          </button>
          <button className="btn-ghost" type="button" onClick={onBack}>
            <X size={18} />
          </button>
        </div>
      </div>

      {detail.error && <div className="skills-error">{detail.error}</div>}

      <div className="skills-detail-layout">
        <div className="skills-detail-markdown">
          {detail.markdownLoading ? (
            <div className="skills-meta-empty">{t("skills.loadingDetails")}</div>
          ) : (
            <AgentMarkdown>{detail.markdown}</AgentMarkdown>
          )}
        </div>

        <aside className="skills-detail-meta" aria-label={t("skills.metadata")}>
          <section className="skills-meta-section">
            <h3>{t("skills.metadata")}</h3>
            <dl className="skills-meta-definition-list">
              <dt>{t("skills.skillPath")}</dt>
              <dd title={detail.skill.path}>{detail.skill.path}</dd>
              <dt>{t("skills.selectedAgent")}</dt>
              <dd>{t("skills.enabledBadge")}</dd>
            </dl>
          </section>

          <section className="skills-meta-section">
            <h3>{t("skills.agentsUsingSkill")}</h3>
            {detail.agentsLoading ? (
              <div className="skills-meta-empty">{t("skills.loadingAgents")}</div>
            ) : detail.agentsUnavailable ? (
              <div className="skills-meta-empty">{t("skills.agentsUnavailable")}</div>
            ) : detail.agents.length === 0 ? (
              <div className="skills-meta-empty">{t("skills.noAgentsUsingSkill")}</div>
            ) : (
              <ul className="skills-meta-list">
                {detail.agents.map((agent) => (
                  <li key={agent.name}>
                    <span>{agent.name}</span>
                    {agent.isSelected && (
                      <span className="skills-meta-kind">{t("skills.selectedAgent")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="skills-meta-section">
            <h3>{t("skills.associatedScripts")}</h3>
            {detail.metadataLoading ? (
              <div className="skills-meta-empty">{t("skills.loadingMetadata")}</div>
            ) : metadata && !metadata.metadataAvailable ? (
              <div className="skills-meta-empty">
                {metadata.unavailableReason || t("skills.metadataUnavailable")}
              </div>
            ) : (
              <MetadataList
                items={metadata?.scripts ?? []}
                emptyText={t("skills.noAssociatedScripts")}
                directoryKind={t("skills.directoryKind")}
              />
            )}
          </section>

          <section className="skills-meta-section">
            <h3>{t("skills.associatedReferences")}</h3>
            {detail.metadataLoading ? (
              <div className="skills-meta-empty">{t("skills.loadingMetadata")}</div>
            ) : metadata && !metadata.metadataAvailable ? (
              <div className="skills-meta-empty">{t("skills.metadataUnavailable")}</div>
            ) : (
              <MetadataList
                items={metadata?.references ?? []}
                emptyText={t("skills.noAssociatedReferences")}
                directoryKind={t("skills.directoryKind")}
              />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
