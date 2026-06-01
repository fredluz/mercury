import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Plus,
  Puzzle,
  Search,
  Wrench,
  X,
} from "../../assets/icons";
import { BarChart3, Code2, Pencil } from "lucide-react";
import type {
  AgentCreationDraft,
  AgentDraftPatch,
} from "../../../../shared/agents";
import {
  AGENT_PACK_CATALOG,
  agentPackMemberDescription,
  agentPackMemberKey,
  agentPackMemberLabel,
  agentPackPresentation,
  type AgentPackDefinition,
  type AgentPackIconKey,
  type AgentPackMember,
} from "../../../../shared/agent-packs";
import {
  dedupeInventoryModels,
  filterInventoryToConnectedProviders,
  type InventoryModel,
} from "../../modelInventory";
import { useI18n } from "../../components/useI18n";

interface AgentDraftReviewProps {
  draft: AgentCreationDraft;
  committing: boolean;
  commitError: string | null;
  onCommit: () => void;
  onUpdateDraft: (patch: AgentDraftPatch) => Promise<void>;
}

type Step = "identity" | "capabilities" | "review";
const STEP_ORDER: Step[] = ["identity", "capabilities", "review"];

interface SkillModalContext {
  pack: AgentPackDefinition;
  member: AgentPackMember;
}

function PackIcon({ icon }: { icon: AgentPackIconKey }): React.JSX.Element {
  switch (icon) {
    case "search":
      return <Search size={16} />;
    case "pencil":
      return <Pencil size={16} />;
    case "code":
      return <Code2 size={16} />;
    case "chart":
      return <BarChart3 size={16} />;
    default:
      return <Puzzle size={16} />;
  }
}

/** A pack member is "on" unless an explicit override turns it off. */
function memberEnabled(
  member: AgentPackMember,
  overrides: Record<string, boolean>,
): boolean {
  if (member.kind === "docs-pointer") return false;
  return overrides[agentPackMemberKey(member)] !== false;
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
  const [step, setStep] = useState<Step>("identity");
  const [openPackId, setOpenPackId] = useState<string | null>(null);
  const [skillModal, setSkillModal] = useState<SkillModalContext | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  const errors = validationErrors(draft);
  const valid = errors.length === 0;
  const selectedPackIdSet = useMemo(
    () => new Set(draft.selectedPackIds),
    [draft.selectedPackIds],
  );

  const skillsSelected = useMemo(() => {
    let count = 0;
    for (const pack of AGENT_PACK_CATALOG) {
      if (!selectedPackIdSet.has(pack.id)) continue;
      for (const member of pack.members) {
        if (memberEnabled(member, draft.skillOverrides)) count += 1;
      }
    }
    return count;
  }, [selectedPackIdSet, draft.skillOverrides]);

  // Curated packs shown as cards (skip the lean "default" baseline + one-skill
  // independent packs, which live behind "Browse all skills").
  const curatedPacks = useMemo(
    () =>
      AGENT_PACK_CATALOG.filter(
        (pack) =>
          pack.id !== "default" &&
          pack.members.filter((m) => m.kind !== "docs-pointer").length > 1,
      ),
    [],
  );

  const browsePacks = useMemo(
    () => AGENT_PACK_CATALOG.filter((pack) => !curatedPacks.includes(pack)),
    [curatedPacks],
  );

  function togglePack(packId: string): void {
    const next = new Set(draft.selectedPackIds);
    if (next.has(packId)) {
      next.delete(packId);
      if (openPackId === packId) setOpenPackId(null);
    } else {
      next.add(packId);
      setOpenPackId(packId);
    }
    void onUpdateDraft({ selectedPackIds: [...next] });
  }

  function toggleMember(member: AgentPackMember): void {
    const key = agentPackMemberKey(member);
    const next = { ...draft.skillOverrides };
    const enabled = memberEnabled(member, draft.skillOverrides);
    if (enabled) next[key] = false;
    else delete next[key];
    void onUpdateDraft({ skillOverrides: next });
  }

  const footerNext =
    step === "review" ? null : STEP_ORDER[STEP_ORDER.indexOf(step) + 1];
  const footerPrev = STEP_ORDER[STEP_ORDER.indexOf(step) - 1] ?? null;

  return (
    <section
      className="agents-step-config"
      aria-label={t("agents.creatorReviewTitle")}
    >
      <div className="agents-step-body">
        <Stepper step={step} />
        <div className="agents-step-divider" />

        {step === "identity" ? (
          <IdentityStep draft={draft} onUpdateDraft={onUpdateDraft} />
        ) : null}

        {step === "capabilities" ? (
          <>
            <div className="agents-step-heading-row">
              <div className="agents-step-heading-text">
                <div className="agents-step-h">
                  {t("agents.capabilitiesHeading")}
                </div>
                <div className="agents-step-sub">
                  {t("agents.capabilitiesSub")}
                </div>
              </div>
              <div className="agents-step-counter">
                {t("agents.capabilitiesSkillsSelected", {
                  count: skillsSelected,
                })}
              </div>
            </div>

            <div className="agents-step-section-label">
              {t("agents.capabilitiesPacks")}
            </div>
            <div className="agents-pack-grid">
              {curatedPacks.map((pack) => {
                const expanded = openPackId === pack.id;
                const added = selectedPackIdSet.has(pack.id);
                const presentation = agentPackPresentation(pack);
                const selectable = pack.members.filter(
                  (m) => m.kind !== "docs-pointer",
                );
                const enabledCount = selectable.filter((m) =>
                  memberEnabled(m, draft.skillOverrides),
                ).length;
                return (
                  <div
                    key={pack.id}
                    className={`agents-pack${expanded ? " expanded" : ""}`}
                    role={expanded ? undefined : "button"}
                    tabIndex={expanded ? undefined : 0}
                    onClick={() => {
                      if (!expanded) setOpenPackId(pack.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        !expanded &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        setOpenPackId(pack.id);
                      }
                    }}
                  >
                    <div className="agents-pack-top">
                      <span className="agents-pack-icon">
                        <PackIcon icon={presentation.icon} />
                      </span>
                      <div className="agents-pack-text">
                        <div className="agents-pack-name">
                          {pack.displayName}
                        </div>
                        <div className="agents-pack-desc">
                          {pack.description}
                        </div>
                      </div>
                      {expanded ? (
                        <AddControl
                          added={added}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePack(pack.id);
                          }}
                          t={t}
                        />
                      ) : null}
                    </div>

                    {expanded ? (
                      <div className="agents-pack-inner">
                        <div className="agents-pack-inner-title">
                          {t("agents.capabilitiesSkillsInPack", {
                            name: draft.displayName || "this agent",
                          })}
                        </div>
                        <div className="agents-skill-grid">
                          {selectable.map((member) => {
                            const on = memberEnabled(
                              member,
                              draft.skillOverrides,
                            );
                            return (
                              <div
                                key={agentPackMemberKey(member)}
                                className={`agents-skill-row${on ? "" : " off"}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSkillModal({ pack, member })}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    setSkillModal({ pack, member });
                                  }
                                }}
                              >
                                <span className="agents-skill-name">
                                  {agentPackMemberLabel(member)}
                                </span>
                                <SwitchButton
                                  on={on}
                                  label={agentPackMemberLabel(member)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleMember(member);
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="agents-pack-foot">
                        <span className="agents-pack-count">
                          {added
                            ? t("agents.capabilitiesSkillFraction", {
                                enabled: enabledCount,
                                total: selectable.length,
                              })
                            : t("agents.capabilitiesSkillCount", {
                                count: selectable.length,
                              })}
                        </span>
                        <AddControl
                          added={added}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePack(pack.id);
                          }}
                          t={t}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="agents-browse-all"
              onClick={() => setBrowseOpen(true)}
            >
              <Puzzle size={16} />
              {t("agents.capabilitiesBrowseAll")} →
            </button>
          </>
        ) : null}

        {step === "review" ? (
          <ReviewStep
            draft={draft}
            errors={errors}
            valid={valid}
            skillsSelected={skillsSelected}
            selectedPackIdSet={selectedPackIdSet}
          />
        ) : null}
      </div>

      {commitError ? (
        <div className="agents-create-error" role="alert">
          {commitError}
        </div>
      ) : null}

      <div className="agents-step-footer">
        {footerPrev ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setStep(footerPrev)}
          >
            {t("agents.creatorBackShort")}
          </button>
        ) : null}
        {footerNext ? (
          <button
            type="button"
            className="btn btn-primary agents-step-footer-grow"
            onClick={() => setStep(footerNext)}
          >
            {t("agents.creatorContinue")}
            <ArrowRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary agents-step-footer-grow"
            onClick={onCommit}
            disabled={committing || !valid}
          >
            {committing
              ? t("agents.creatorCommitting")
              : t("agents.creatorCreateAgent")}
          </button>
        )}
      </div>

      {skillModal ? (
        <SkillDetailModal
          context={skillModal}
          enabled={memberEnabled(skillModal.member, draft.skillOverrides)}
          onToggle={() => toggleMember(skillModal.member)}
          onClose={() => setSkillModal(null)}
        />
      ) : null}

      {browseOpen ? (
        <BrowseAllDrawer
          packs={browsePacks}
          selectedPackIdSet={selectedPackIdSet}
          onToggle={togglePack}
          onClose={() => setBrowseOpen(false)}
        />
      ) : null}
    </section>
  );
}

function Stepper({ step }: { step: Step }): React.JSX.Element {
  const { t } = useI18n();
  const labels: Record<Step, string> = {
    identity: t("agents.stepIdentity"),
    capabilities: t("agents.stepCapabilities"),
    review: t("agents.stepReview"),
  };
  const currentIndex = STEP_ORDER.indexOf(step);
  return (
    <div className="agents-stepper">
      {STEP_ORDER.map((id, index) => {
        const state =
          index < currentIndex
            ? "done"
            : index === currentIndex
              ? "current"
              : "upcoming";
        return (
          <div key={id} className="agents-stepper-segment">
            {index > 0 ? (
              <div
                className={`agents-stepper-connector${
                  index <= currentIndex ? " gold" : ""
                }`}
              />
            ) : null}
            <div className={`agents-step ${state}`}>
              <div className="agents-step-circle">
                {state === "done" ? <Check size={12} /> : index + 1}
              </div>
              <div className="agents-step-label">{labels[id]}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddControl({
  added,
  onClick,
  t,
}: {
  added: boolean;
  onClick: (e: React.MouseEvent) => void;
  t: (key: string) => string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`agents-add-ctl${added ? " added" : ""}`}
      onClick={onClick}
    >
      {added ? <Check size={12} /> : <Plus size={12} />}
      {added ? t("agents.capabilitiesAdded") : t("agents.capabilitiesAdd")}
    </button>
  );
}

function SwitchButton({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: (e: React.MouseEvent) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="agents-switch-btn"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className={`agents-switch${on ? " on" : ""}`} />
    </button>
  );
}

function IdentityStep({
  draft,
  onUpdateDraft,
}: {
  draft: AgentCreationDraft;
  onUpdateDraft: (patch: AgentDraftPatch) => Promise<void>;
}): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(draft.displayName);
  const [description, setDescription] = useState(draft.description ?? "");
  const [persona, setPersona] = useState(draft.persona ?? "");
  const [inventory, setInventory] = useState<InventoryModel[]>([]);
  // Re-seed the editable fields when Mercury mutates the draft from chat. This
  // "adjust state during render" pattern keeps the inputs in sync with live
  // draft changes without a cascading-render effect.
  const [seeded, setSeeded] = useState({
    displayName: draft.displayName,
    description: draft.description ?? "",
    persona: draft.persona ?? "",
  });
  if (
    seeded.displayName !== draft.displayName ||
    seeded.description !== (draft.description ?? "") ||
    seeded.persona !== (draft.persona ?? "")
  ) {
    setSeeded({
      displayName: draft.displayName,
      description: draft.description ?? "",
      persona: draft.persona ?? "",
    });
    setName(draft.displayName);
    setDescription(draft.description ?? "");
    setPersona(draft.persona ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.hermesAPI.listModels(),
      window.hermesAPI.getEnv(draft.profile).catch(() => ({})),
      window.hermesAPI.getCredentialPool().catch(() => ({})),
    ])
      .then(([models, env, credPool]) => {
        if (cancelled) return;
        const normalized = filterInventoryToConnectedProviders(
          models.map((entry) => ({
            id: entry.id,
            provider: entry.provider,
            model: entry.model,
            baseUrl: entry.baseUrl,
          })),
          { env, credentialPool: credPool },
        );
        setInventory(dedupeInventoryModels(normalized));
      })
      .catch(() => {
        if (!cancelled) setInventory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.profile]);

  const providers = useMemo(
    () => [
      ...new Set(inventory.map((entry) => entry.provider).filter(Boolean)),
    ],
    [inventory],
  );
  const provider = draft.model?.provider ?? "";
  const model = draft.model?.model ?? "";
  const providerModels = useMemo(
    () => inventory.filter((entry) => entry.provider === provider),
    [inventory, provider],
  );

  const letter = (name.trim() || "A").charAt(0).toUpperCase();

  return (
    <div className="agents-identity">
      <div className="agents-step-heading-row">
        <div className="agents-step-heading-text">
          <div className="agents-step-h">{t("agents.identityHeading")}</div>
          <div className="agents-step-sub">{t("agents.identitySub")}</div>
        </div>
      </div>

      <div className="agents-identity-top">
        <div className="agents-identity-avatar" aria-hidden="true">
          {letter}
        </div>
        <label className="agents-field agents-field-grow">
          <span>{t("agents.identityName")}</span>
          <input
            className="input"
            value={name}
            placeholder={t("agents.identityNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() !== draft.displayName) {
                void onUpdateDraft({ displayName: name.trim() });
              }
            }}
          />
        </label>
      </div>

      <label className="agents-field">
        <span>{t("agents.identityDescription")}</span>
        <input
          className="input"
          value={description}
          placeholder={t("agents.identityDescriptionPlaceholder")}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== (draft.description ?? "")) {
              void onUpdateDraft({ description });
            }
          }}
        />
      </label>

      <label className="agents-field">
        <span>{t("agents.identityPersona")}</span>
        <textarea
          className="input agents-field-textarea"
          value={persona}
          placeholder={t("agents.identityPersonaPlaceholder")}
          onChange={(e) => setPersona(e.target.value)}
          onBlur={() => {
            if (persona !== (draft.persona ?? "")) {
              void onUpdateDraft({ persona });
            }
          }}
        />
      </label>

      <div className="agents-field-row">
        <label className="agents-field agents-field-grow">
          <span>{t("agents.modelProvider")}</span>
          <div className="agents-select-wrap">
            <select
              className="agents-select"
              value={provider}
              onChange={(e) => {
                const nextProvider = e.target.value;
                const next = inventory.filter(
                  (entry) => entry.provider === nextProvider,
                );
                void onUpdateDraft({
                  model: {
                    provider: nextProvider,
                    model: next[0]?.model ?? "",
                    baseUrl: next[0]?.baseUrl ?? "",
                  },
                });
              }}
            >
              <option value="">{t("agents.identityModelChoose")}</option>
              {providers.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </label>
        <label className="agents-field agents-field-grow">
          <span>{t("agents.modelName")}</span>
          <div className="agents-select-wrap">
            <select
              className="agents-select"
              value={model}
              disabled={!provider || providerModels.length === 0}
              onChange={(e) => {
                const selected = providerModels.find(
                  (entry) => entry.model === e.target.value,
                );
                void onUpdateDraft({
                  model: {
                    provider,
                    model: e.target.value,
                    baseUrl: selected?.baseUrl ?? "",
                  },
                });
              }}
            >
              <option value="">{t("agents.identityModelNotSet")}</option>
              {providerModels.map((entry) => (
                <option
                  key={`${entry.provider}:${entry.model}`}
                  value={entry.model}
                >
                  {entry.model}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </label>
      </div>
    </div>
  );
}

function ReviewStep({
  draft,
  errors,
  valid,
  skillsSelected,
  selectedPackIdSet,
}: {
  draft: AgentCreationDraft;
  errors: string[];
  valid: boolean;
  skillsSelected: number;
  selectedPackIdSet: Set<string>;
}): React.JSX.Element {
  const { t } = useI18n();
  const empty = t("agents.creatorNotSet");
  const modelSummary =
    draft.model?.provider && draft.model?.model
      ? `${draft.model.provider} / ${draft.model.model}`
      : empty;
  const personaSummary =
    [draft.description, draft.persona]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" — ") || empty;
  const packNames = AGENT_PACK_CATALOG.filter((pack) =>
    selectedPackIdSet.has(pack.id),
  ).map((pack) => pack.displayName);

  return (
    <div className="agents-review">
      <div className="agents-step-heading-row">
        <div className="agents-step-heading-text">
          <div className="agents-step-h">{t("agents.reviewHeading")}</div>
          <div className="agents-step-sub">{t("agents.reviewSub")}</div>
        </div>
      </div>

      <div className="agents-review-card">
        <div className="agents-review-card-title">
          {t("agents.reviewIdentity")}
        </div>
        <dl className="agents-review-fields">
          <div>
            <dt>{t("agents.identityName")}</dt>
            <dd>{draft.displayName.trim() || empty}</dd>
          </div>
          <div>
            <dt>{t("agents.creatorBackendProfile")}</dt>
            <dd>{draft.profile || empty}</dd>
          </div>
          <div>
            <dt>{t("agents.creatorModel")}</dt>
            <dd>{modelSummary}</dd>
          </div>
          <div>
            <dt>{t("agents.creatorDescriptionPersona")}</dt>
            <dd>{personaSummary}</dd>
          </div>
        </dl>
      </div>

      <div className="agents-review-card">
        <div className="agents-review-card-title">
          {t("agents.reviewCapabilities")}
        </div>
        <div className="agents-review-pills">
          {packNames.length ? (
            packNames.map((packName) => (
              <span key={packName} className="agents-review-pill">
                {packName}
              </span>
            ))
          ) : (
            <span className="agents-review-empty">
              {t("agents.reviewNoPacks")}
            </span>
          )}
        </div>
        <div className="agents-step-counter agents-review-counter">
          {t("agents.capabilitiesSkillsSelected", { count: skillsSelected })}
        </div>
      </div>

      <div
        className={`agents-review-validation${valid ? " ok" : ""}`}
        role="status"
      >
        <span className="agents-review-validation-title">
          {t("agents.creatorValidationTitle")}
        </span>
        {valid ? (
          <p className="agents-review-validation-ok">
            {t("agents.creatorValidationOk")}
          </p>
        ) : (
          <ul>
            {errors.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkillDetailModal({
  context,
  enabled,
  onToggle,
  onClose,
}: {
  context: SkillModalContext;
  enabled: boolean;
  onToggle: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const { pack, member } = context;
  const presentation = agentPackPresentation(pack);
  const category =
    member.kind === "skill" ? member.category : presentation.category;
  const kindLabel =
    member.kind === "tool"
      ? t("agents.skillModalKindTool")
      : t("agents.skillModalKindSkill");

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="agents-modal-overlay open" onClick={onClose}>
      <div
        className="agents-modal-card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agents-modal-head">
          <span className="agents-modal-icon">
            <PackIcon icon={presentation.icon} />
          </span>
          <div className="agents-modal-title-wrap">
            <div className="agents-modal-title">
              {agentPackMemberLabel(member)}
            </div>
            <div className="agents-modal-pack">{pack.displayName} pack</div>
          </div>
          <button
            type="button"
            className="agents-modal-close"
            aria-label={t("agents.capabilitiesDrawerClose")}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div className="agents-modal-body">
          <p className="agents-modal-desc">
            {agentPackMemberDescription(member)}
          </p>
          <div className="agents-modal-meta">
            <span className="agents-meta-tag kind">{kindLabel}</span>
            <span className="agents-meta-tag cat">{category}</span>
            <span className={`agents-meta-tag state ${enabled ? "on" : "off"}`}>
              <span className="agents-meta-dot" />
              {enabled
                ? t("agents.skillModalEnabled")
                : t("agents.skillModalDisabled")}
            </span>
          </div>
          <div className="agents-modal-toggle-row">
            <div className="agents-modal-toggle-label">
              {t("agents.skillModalInclude")}
              <div className="agents-modal-toggle-sub">
                {t("agents.skillModalIncludeSub")}
              </div>
            </div>
            <SwitchButton
              on={enabled}
              label={agentPackMemberLabel(member)}
              onClick={onToggle}
            />
          </div>
          <div className="agents-modal-foot">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onClose}
            >
              {t("agents.skillModalDone")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrowseAllDrawer({
  packs,
  selectedPackIdSet,
  onToggle,
  onClose,
}: {
  packs: AgentPackDefinition[];
  selectedPackIdSet: Set<string>;
  onToggle: (packId: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="agents-modal-overlay open" onClick={onClose}>
      <aside
        className="agents-drawer"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agents-drawer-head">
          <div>
            <div className="agents-modal-title">
              {t("agents.capabilitiesDrawerTitle")}
            </div>
            <div className="agents-modal-pack">
              {t("agents.capabilitiesDrawerSub")}
            </div>
          </div>
          <button
            type="button"
            className="agents-modal-close"
            aria-label={t("agents.capabilitiesDrawerClose")}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div className="agents-drawer-body">
          {packs.length === 0 ? (
            <p className="agents-review-empty">
              {t("agents.capabilitiesDrawerEmpty")}
            </p>
          ) : (
            packs.map((pack) => {
              const added = selectedPackIdSet.has(pack.id);
              const skill = pack.members.find((m) => m.kind === "skill");
              return (
                <div key={pack.id} className="agents-drawer-row">
                  <span className="agents-drawer-icon">
                    <Wrench size={14} />
                  </span>
                  <div className="agents-drawer-text">
                    <div className="agents-drawer-name">{pack.displayName}</div>
                    <div className="agents-drawer-sub">
                      {skill && skill.kind === "skill"
                        ? skill.category
                        : pack.description}
                    </div>
                  </div>
                  <AddControl
                    added={added}
                    onClick={() => onToggle(pack.id)}
                    t={t}
                  />
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
