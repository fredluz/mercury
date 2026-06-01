import { useMemo, useState } from "react";
import type { AgentCreationDraft, AgentDraftPatch } from "../../../../shared/agents";
import {
  AGENT_PACK_CATALOG,
  agentPackMemberKey,
  deriveAgentPackState,
} from "../../../../shared/agent-packs";
import { useI18n } from "../../components/useI18n";

interface AgentDraftReviewProps {
  draft: AgentCreationDraft;
  committing: boolean;
  commitError: string | null;
  onCommit: () => void;
  onUpdateDraft: (patch: AgentDraftPatch) => Promise<void>;
}

function valueOrEmpty(value: string | undefined, empty: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : empty;
}

function summarizeToolOverrides(
  overrides: Record<string, boolean>,
  empty: string,
): string {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return empty;
  return entries
    .map(([key, enabled]) => `${key}: ${enabled ? "on" : "off"}`)
    .join(", ");
}

function validationErrors(draft: AgentCreationDraft): string[] {
  const errors: string[] = [];
  if (!draft.displayName.trim()) errors.push("agents.creatorValidationName");
  if (!draft.profile.trim()) errors.push("agents.creatorValidationProfile");
  if (!draft.model?.provider || !draft.model?.model) {
    errors.push("agents.creatorValidationModel");
  }
  if (draft.status !== "draft") errors.push("agents.creatorValidationStatus");
  return errors;
}

export function AgentDraftReview({
  draft,
  committing,
  commitError,
  onCommit,
  onUpdateDraft,
}: AgentDraftReviewProps): React.JSX.Element {
  const { t } = useI18n();
  const [expandedPackIds, setExpandedPackIds] = useState<Set<string>>(new Set());
  const errors = validationErrors(draft);
  const commitDisabled = committing || errors.length > 0;
  const empty = t("agents.creatorNotSet");
  const modelSummary = draft.model?.provider && draft.model?.model
    ? `${draft.model.provider} / ${draft.model.model}`
    : empty;
  const personaSummary = [draft.description, draft.persona]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" — ") || empty;
  const selectedPackIdSet = useMemo(
    () => new Set(draft.selectedPackIds),
    [draft.selectedPackIds],
  );
  const enabledMemberKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const pack of AGENT_PACK_CATALOG) {
      if (!selectedPackIdSet.has(pack.id)) continue;
      for (const member of pack.members) {
        if (member.kind !== "docs-pointer") keys.add(agentPackMemberKey(member));
      }
    }
    return keys;
  }, [selectedPackIdSet]);
  const selectedPackNames = AGENT_PACK_CATALOG.filter((pack) =>
    selectedPackIdSet.has(pack.id),
  ).map((pack) => pack.displayName);
  const packSummary = selectedPackNames.length ? selectedPackNames.join(", ") : empty;
  const docsSummary = draft.docsPointers.length
    ? draft.docsPointers.map((pointer) => pointer.title).join(", ")
    : empty;
  const memorySummary = draft.memory?.userProfile?.trim() || empty;
  const toolSummary = summarizeToolOverrides(draft.toolsetOverrides, empty);

  function togglePack(packId: string): void {
    const next = new Set(draft.selectedPackIds);
    if (next.has(packId)) next.delete(packId);
    else next.add(packId);
    void onUpdateDraft({ selectedPackIds: [...next] });
  }

  function toggleExpanded(packId: string): void {
    setExpandedPackIds((current) => {
      const next = new Set(current);
      if (next.has(packId)) next.delete(packId);
      else next.add(packId);
      return next;
    });
  }

  return (
    <aside className="agents-draft-review" aria-label={t("agents.creatorReviewTitle")}>
      <div className="agents-draft-review-header">
        <div>
          <p className="agents-draft-eyebrow">{t("agents.creatorReviewEyebrow")}</p>
          <h3>{t("agents.creatorReviewTitle")}</h3>
        </div>
        <span className="agents-draft-revision">
          {t("agents.creatorRevision", { revision: draft.revision })}
        </span>
      </div>

      <dl className="agents-draft-fields">
        <div>
          <dt>{t("agents.creatorDisplayName")}</dt>
          <dd>{valueOrEmpty(draft.displayName, empty)}</dd>
        </div>
        <div>
          <dt>{t("agents.creatorBackendProfile")}</dt>
          <dd>{valueOrEmpty(draft.profile, empty)}</dd>
        </div>
        <div>
          <dt>{t("agents.creatorModel")}</dt>
          <dd>{modelSummary}</dd>
        </div>
        <div>
          <dt>{t("agents.creatorDescriptionPersona")}</dt>
          <dd>{personaSummary}</dd>
        </div>
        <div>
          <dt>{t("agents.creatorSelectedPacks")}</dt>
          <dd>{packSummary}</dd>
        </div>
        <div>
          <dt>{t("agents.creatorTools")}</dt>
          <dd>{toolSummary}</dd>
        </div>
        <div>
          <dt>{t("agents.creatorSkillsDocs")}</dt>
          <dd>
            {t("agents.creatorPackSkillSummary", {
              count: draft.selectedPackIds.length,
            })}
            {docsSummary !== empty ? ` · ${docsSummary}` : ""}
          </dd>
        </div>
        <div>
          <dt>{t("agents.creatorMemory")}</dt>
          <dd>{memorySummary}</dd>
        </div>
      </dl>

      <div className="agents-draft-validation">
        <h4>{t("agents.creatorValidationTitle")}</h4>
        {errors.length === 0 ? (
          <p className="agents-draft-validation-ok">
            {t("agents.creatorValidationOk")}
          </p>
        ) : (
          <ul>
            {errors.map((errorKey) => (
              <li key={errorKey}>{t(errorKey)}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="agents-pack-picker" aria-label="Agent pack picker">
        <h4>{t("agents.creatorSelectedPacks")}</h4>
        <div className="agents-pack-list">
          {AGENT_PACK_CATALOG.map((pack) => {
            const selected = selectedPackIdSet.has(pack.id);
            const state = selected ? "on" : deriveAgentPackState(pack, enabledMemberKeys);
            const expanded = expandedPackIds.has(pack.id);
            return (
              <div key={pack.id} className={`agents-pack-card agents-pack-card-${state}`}>
                <div className="agents-pack-card-header">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePack(pack.id)}
                    />
                    <span>{pack.displayName}</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => toggleExpanded(pack.id)}
                  >
                    {expanded ? "Hide" : "Members"}
                  </button>
                </div>
                <p>{pack.description}</p>
                <span className="agents-pack-state">{state}</span>
                {expanded ? (
                  <ul className="agents-pack-members">
                    {pack.members.map((member) => (
                      <li key={agentPackMemberKey(member)}>
                        {member.kind === "skill"
                          ? `Skill: ${member.category}/${member.directoryName}`
                          : member.kind === "tool"
                            ? `Tool: ${member.key}`
                            : `Docs: ${member.title}`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {commitError ? (
        <div className="agents-create-error" role="alert">
          {commitError}
        </div>
      ) : null}

      <button
        className="btn btn-primary"
        onClick={onCommit}
        disabled={commitDisabled}
      >
        {committing ? t("agents.creatorCommitting") : t("agents.creatorCommit")}
      </button>
    </aside>
  );
}
