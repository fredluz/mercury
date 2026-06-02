import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { Search, X, Refresh, Plus } from "../../assets/icons";
import { SkillModals } from "./components/SkillModals";
import { parseSkillMarkdownMeta } from "./skillMarkdownMeta";
import {
  SkillCategorySection,
  type InstalledSkill,
  type SkillListItem,
} from "./components/SkillCategorySection";
import {
  SkillDetailPanel,
  type SelectedSkillDetail,
  type SkillAgentUsage,
} from "./components/SkillDetailPanel";
import { useI18n } from "../../components/useI18n";
import type {
  SkillMarkdownImportRequest,
  SkillMutationTarget,
  SkillSourceCandidate,
  SkillSourceImportRequest,
} from "../../../../shared/skills";

interface BundledSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
  directoryName: string;
}

interface ProfileInfo {
  name: string;
  isDefault: boolean;
}

interface SkillsProps {
  profile?: string;
}

type Tab = "installed" | "browse";
type AddSkillMode = "markdown" | "github" | "command";

type PendingSkillChange = {
  key: string;
  action: "install" | "uninstall";
  target: SkillMutationTarget;
  name: string;
  category?: string;
  directoryName?: string;
  sequence: number;
};

type PendingSkillChanges = Record<string, PendingSkillChange>;

type GroupedSkills = Array<{
  category: string;
  skills: SkillListItem[];
  enabledCount: number;
  totalCount: number;
  pendingCount: number;
}>;

function normalizePart(value: string): string {
  return value.trim().toLowerCase();
}

type SkillIdentity = { category?: string; name: string; directoryName?: string };
type SkillActionIdentity = SkillIdentity & {
  source?: string;
  path?: string;
  installedSkill?: InstalledSkill;
};

function skillDirectoryPart(skill: SkillIdentity): string {
  return normalizePart(skill.directoryName || skill.name);
}

function skillIdentityKey(skill: SkillIdentity): string {
  return `${normalizePart(skill.category || "")}\u0000${skillDirectoryPart(skill)}`;
}

function skillActionKey(skill: SkillActionIdentity): string {
  const source = skill.source || "installed";
  const path = skill.installedSkill?.path || skill.path || "";
  return [source, normalizePart(skill.category || ""), skillDirectoryPart(skill), path].join("\u0000");
}

function skillTargetLabel(target: SkillMutationTarget): string {
  const qualifier = [target.category, target.directoryName].filter(Boolean).join("/");
  return qualifier ? `${target.name} (${qualifier})` : target.name;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function groupSkills(skills: SkillListItem[]): GroupedSkills {
  const groups = new Map<string, SkillListItem[]>();
  for (const skill of skills) {
    const category = skill.category || "";
    const group = groups.get(category) ?? [];
    group.push(skill);
    groups.set(category, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, group]) => ({
      category,
      skills: group.sort((a, b) => a.name.localeCompare(b.name)),
      enabledCount: group.filter((skill) => skill.enabled).length,
      totalCount: group.length,
      pendingCount: group.filter((skill) => Boolean(skill.pendingAction)).length,
    }));
}

function selectedProfileName(profile?: string): string {
  return profile || "default";
}

function installTargetForSkill(skill: SkillListItem): SkillMutationTarget {
  return {
    action: "install",
    name: skill.name,
    category: skill.category,
    directoryName: skill.directoryName,
  };
}

function installedTargetFromSkill(skill: SkillListItem | InstalledSkill): InstalledSkill | undefined {
  return "source" in skill ? skill.installedSkill : skill;
}

function uninstallTargetForSkill(skill: SkillListItem | InstalledSkill): SkillMutationTarget | null {
  const installedSkill = installedTargetFromSkill(skill);
  if (!installedSkill) return null;
  return {
    action: "uninstall",
    name: installedSkill.name,
    category: installedSkill.category,
    directoryName: installedSkill.directoryName,
    path: installedSkill.path,
  };
}

function targetMatchesInstalledSkill(target: SkillMutationTarget, skill: InstalledSkill): boolean {
  if (target.path && target.path === skill.path) return true;
  return skillIdentityKey(target) === skillIdentityKey(skill);
}

function targetSatisfiedByInstalledList(
  target: SkillMutationTarget,
  installedSkills: InstalledSkill[],
): boolean {
  if (target.action === "install") {
    return installedSkills.some((skill) => skillIdentityKey(skill) === skillIdentityKey(target));
  }

  if (target.path) {
    return !installedSkills.some((skill) => skill.path === target.path);
  }

  return !installedSkills.some((skill) => skillIdentityKey(skill) === skillIdentityKey(target));
}

function installedMatchForTarget(
  target: SkillMutationTarget,
  installedSkills: InstalledSkill[],
): InstalledSkill | undefined {
  if (target.path) {
    const byPath = installedSkills.find((skill) => skill.path === target.path);
    if (byPath) return byPath;
  }
  return installedSkills.find((skill) => skillIdentityKey(skill) === skillIdentityKey(target));
}

function rebasePendingSkillChanges(
  pending: PendingSkillChanges,
  installedSkills: InstalledSkill[],
): PendingSkillChanges {
  const next: PendingSkillChanges = {};
  for (const change of Object.values(pending)) {
    if (targetSatisfiedByInstalledList(change.target, installedSkills)) continue;

    if (change.action === "uninstall") {
      const freshInstalled = installedMatchForTarget(change.target, installedSkills);
      next[change.key] = freshInstalled
        ? {
            ...change,
            target: {
              ...change.target,
              name: freshInstalled.name,
              category: freshInstalled.category,
              directoryName: freshInstalled.directoryName,
              path: freshInstalled.path,
            },
          }
        : change;
    } else {
      next[change.key] = change;
    }
  }
  return next;
}

function pendingKeyCandidates(skill: SkillListItem | InstalledSkill): string[] {
  if ("source" in skill) {
    const keys = [skill.installedSkill ? skillIdentityKey(skill.installedSkill) : "", skillIdentityKey(skill)];
    return Array.from(new Set(keys.filter(Boolean)));
  }
  return [skillIdentityKey(skill)];
}

function pendingKeyForSkill(skill: SkillListItem | InstalledSkill): string {
  return pendingKeyCandidates(skill)[0] ?? skillIdentityKey(skill);
}

function pendingForSkill(
  skill: SkillListItem | InstalledSkill,
  pendingChanges: PendingSkillChanges,
): PendingSkillChange | undefined {
  for (const key of pendingKeyCandidates(skill)) {
    const change = pendingChanges[key];
    if (change) return change;
  }
  return undefined;
}

function Skills({ profile }: SkillsProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("installed");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
  const [pendingSkillChanges, setPendingSkillChanges] = useState<PendingSkillChanges>({});
  const [savingDraft, setSavingDraft] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<SelectedSkillDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<AddSkillMode>("markdown");
  const [importName, setImportName] = useState("");
  const [importCategory, setImportCategory] = useState("custom");
  const [importDescription, setImportDescription] = useState("");
  const [importMarkdown, setImportMarkdown] = useState("");
  // Track whether the user has manually edited Name/Description so auto-fill from
  // pasted Markdown never clobbers their typing.
  const [importNameTouched, setImportNameTouched] = useState(false);
  const [importDescriptionTouched, setImportDescriptionTouched] = useState(false);
  const [importSource, setImportSource] = useState("");
  const [sourceCandidates, setSourceCandidates] = useState<SkillSourceCandidate[]>([]);
  const [selectedSourceCandidateId, setSelectedSourceCandidateId] = useState<string>("");
  const [previewingSource, setPreviewingSource] = useState(false);
  const [sourcePreviewed, setSourcePreviewed] = useState(false);
  const [remoteOnlyMode, setRemoteOnlyMode] = useState<boolean | null>(null);
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const listScrollTopRef = useRef(0);
  const restoreListScrollRef = useRef(false);
  const detailRequestRef = useRef(0);
  const draftSequenceRef = useRef(0);

  const pendingChanges = useMemo(
    () => Object.values(pendingSkillChanges).sort((a, b) => a.sequence - b.sequence),
    [pendingSkillChanges],
  );
  const pendingCount = pendingChanges.length;
  const pendingEnableCount = pendingChanges.filter((change) => change.action === "install").length;
  const pendingDisableCount = pendingChanges.filter((change) => change.action === "uninstall").length;

  useLayoutEffect(() => {
    if (selectedDetail || !restoreListScrollRef.current) return;
    restoreListScrollRef.current = false;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = listScrollTopRef.current;
    }
  }, [selectedDetail]);

  const loadInstalled = useCallback(async (): Promise<InstalledSkill[]> => {
    const list = await window.hermesAPI.listInstalledSkills(profile);
    setInstalledSkills(list);
    setPendingSkillChanges((current) => rebasePendingSkillChanges(current, list));
    return list;
  }, [profile]);

  const loadBundled = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listBundledSkills();
    setBundledSkills(list);
  }, []);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadInstalled(), loadBundled()]);
    } catch (err) {
      setError((err as Error).message || t("skills.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [loadInstalled, loadBundled, t]);

  useEffect(() => {
    setPendingSkillChanges({});
    setSelectedDetail(null);
    void Promise.resolve().then(() => loadAll());
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI
      .isRemoteOnlyMode()
      .then((isRemoteOnly) => {
        if (!cancelled) setRemoteOnlyMode(isRemoteOnly);
      })
      .catch(() => {
        if (!cancelled) setRemoteOnlyMode(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (remoteOnlyMode === true && importMode !== "markdown") {
      setImportMode("markdown");
    }
  }, [importMode, remoteOnlyMode]);

  const installedByKey = useMemo(() => {
    const map = new Map<string, InstalledSkill>();
    for (const skill of installedSkills) map.set(skillIdentityKey(skill), skill);
    return map;
  }, [installedSkills]);

  async function loadAgentsUsingSkill(
    skill: InstalledSkill,
  ): Promise<{ agents: SkillAgentUsage[]; unavailable: boolean }> {
    let profiles: ProfileInfo[];
    try {
      profiles = await window.hermesAPI.listProfiles();
    } catch {
      return { agents: [], unavailable: true };
    }

    const selected = selectedProfileName(profile);
    const results = await Promise.allSettled(
      profiles.map(async (agent) => {
        const skills = await window.hermesAPI.listInstalledSkills(agent.name);
        return skills.some((candidate) => skillIdentityKey(candidate) === skillIdentityKey(skill))
          ? { name: agent.name, isSelected: agent.name === selected || (agent.isDefault && selected === "default") }
          : null;
      }),
    );

    const agents = results
      .filter((result): result is PromiseFulfilledResult<SkillAgentUsage | null> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((agent): agent is SkillAgentUsage => agent !== null)
      .sort((a, b) => Number(b.isSelected) - Number(a.isSelected) || a.name.localeCompare(b.name));

    return {
      agents,
      unavailable: results.length > 0 && results.every((result) => result.status === "rejected"),
    };
  }

  async function handleViewDetail(skill: SkillListItem): Promise<void> {
    const installedSkill = skill.installedSkill;
    if (!installedSkill || skill.pendingAction === "uninstall") {
      setNotice(
        skill.pendingAction === "uninstall"
          ? t("skills.detailUnavailablePendingDisable")
          : t("skills.detailUnavailableForBundled"),
      );
      return;
    }

    listScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;

    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setSelectedDetail({
      skill: installedSkill,
      markdown: "",
      markdownLoading: true,
      metadata: null,
      metadataLoading: true,
      agents: [],
      agentsLoading: true,
      agentsUnavailable: false,
      error: "",
    });
    setError("");

    const [contentResult, metadataResult, agentsResult] = await Promise.allSettled([
      window.hermesAPI.getSkillContent(installedSkill.path),
      window.hermesAPI.getSkillMetadata(installedSkill.path),
      loadAgentsUsingSkill(installedSkill),
    ]);

    if (detailRequestRef.current !== requestId) return;

    setSelectedDetail((current) => {
      if (!current || skillActionKey(current.skill) !== skillActionKey(installedSkill)) return current;
      const next: SelectedSkillDetail = {
        ...current,
        markdownLoading: false,
        metadataLoading: false,
        agentsLoading: false,
      };

      if (contentResult.status === "fulfilled") {
        next.markdown = contentResult.value;
      } else {
        next.error = t("skills.detailLoadFailed");
      }

      if (metadataResult.status === "fulfilled") {
        next.metadata = metadataResult.value;
      } else {
        next.metadata = {
          path: installedSkill.path,
          scripts: [],
          references: [],
          metadataAvailable: false,
          unavailableReason: t("skills.metadataUnavailable"),
        };
      }

      if (agentsResult.status === "fulfilled") {
        next.agents = agentsResult.value.agents;
        next.agentsUnavailable = agentsResult.value.unavailable;
      } else {
        next.agentsUnavailable = true;
      }

      return next;
    });
  }

  function removePendingForSkill(skill: SkillListItem | InstalledSkill): void {
    const keys = pendingKeyCandidates(skill);
    setPendingSkillChanges((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function stageSkillEnabledState(skill: SkillListItem | InstalledSkill, desiredEnabled: boolean): void {
    const baseEnabled = "source" in skill ? skill.baseEnabled : true;
    const key = pendingKeyForSkill(skill);
    setError("");
    setNotice("");

    if (desiredEnabled === baseEnabled) {
      removePendingForSkill(skill);
      return;
    }

    const target = desiredEnabled
      ? installTargetForSkill(skill as SkillListItem)
      : uninstallTargetForSkill(skill);

    if (!target) {
      removePendingForSkill(skill);
      if (desiredEnabled) {
        setError(t("skills.installFailed"));
      }
      return;
    }

    if (!desiredEnabled && selectedDetail && targetMatchesInstalledSkill(target, selectedDetail.skill)) {
      restoreListScrollRef.current = true;
      setSelectedDetail(null);
    }

    const sequence = draftSequenceRef.current + 1;
    draftSequenceRef.current = sequence;
    setPendingSkillChanges((current) => ({
      ...current,
      [key]: {
        key,
        action: target.action,
        target,
        name: target.name,
        category: target.category,
        directoryName: target.directoryName,
        sequence,
      },
    }));
  }

  function handleInstallSkill(skill: SkillListItem): void {
    stageSkillEnabledState(skill, true);
  }

  function handleDisableSkill(skill: SkillListItem | InstalledSkill): void {
    stageSkillEnabledState(skill, false);
  }

  function handleBackToSkillList(): void {
    restoreListScrollRef.current = true;
    setSelectedDetail(null);
  }

  function handleCategoryAction(
    _category: string,
    skills: SkillListItem[],
    action: "enable" | "disable",
  ): void {
    const desiredEnabled = action === "enable";
    for (const skill of skills) {
      if (skill.enabled !== desiredEnabled) {
        stageSkillEnabledState(skill, desiredEnabled);
      }
    }
  }

  async function savePendingChanges(): Promise<boolean> {
    if (savingDraft) return false;
    const changes = Object.values(pendingSkillChanges).sort((a, b) => a.sequence - b.sequence);
    if (changes.length === 0) return true;

    setSavingDraft(true);
    setError("");
    setNotice("");

    try {
      const result = await window.hermesAPI.mutateSkills(
        changes.map((change) => change.target),
        profile,
      );

      let refreshedInstalled: InstalledSkill[];
      try {
        refreshedInstalled = await window.hermesAPI.listInstalledSkills(profile);
        setInstalledSkills(refreshedInstalled);
      } catch (err) {
        setError(errorMessage(err, t("skills.loadFailed")));
        return false;
      }

      const failedKeys = new Set<string>();
      const failureMessages: string[] = [];

      changes.forEach((change, index) => {
        const item = result.results[index];
        if (!item) {
          failedKeys.add(change.key);
          failureMessages.push(
            `${skillTargetLabel(change.target)}: ${t("skills.pendingSaveMissingResult")}`,
          );
          return;
        }

        if (!item.success) {
          failedKeys.add(change.key);
          failureMessages.push(`${skillTargetLabel(item.target)}: ${item.error}`);
          return;
        }

        if (!targetSatisfiedByInstalledList(change.target, refreshedInstalled)) {
          failedKeys.add(change.key);
          failureMessages.push(
            `${skillTargetLabel(change.target)}: ${t("skills.pendingSaveNotReflected")}`,
          );
        }
      });

      setPendingSkillChanges((current) => {
        const failedPending: PendingSkillChanges = {};
        const pendingToRebase: PendingSkillChanges = {};
        const attemptedKeys = new Set(changes.map((change) => change.key));
        for (const [key, change] of Object.entries(current)) {
          if (failedKeys.has(key)) {
            failedPending[key] = change;
          } else if (!attemptedKeys.has(key)) {
            pendingToRebase[key] = change;
          }
        }
        return {
          ...rebasePendingSkillChanges(pendingToRebase, refreshedInstalled),
          ...failedPending,
        };
      });

      if (result.updated > 0) {
        setNotice(t("skills.pendingSaved", { count: result.updated }));
      } else if (failureMessages.length === 0) {
        setNotice(t("skills.pendingNoChanges"));
      }

      if (failureMessages.length > 0) {
        setError(t("skills.pendingSaveFailedDetailed", { details: failureMessages.join("; ") }));
        return false;
      }

      return true;
    } catch (err) {
      setError(errorMessage(err, t("skills.operationFailed")));
      return false;
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSaveDraft(): Promise<void> {
    await savePendingChanges();
  }

  async function handleDiscardDraft(): Promise<void> {
    setPendingSkillChanges({});
    setSelectedDetail(null);
    setError("");
    setNotice(t("skills.pendingDiscarded"));
    try {
      await loadInstalled();
    } catch (err) {
      setError(errorMessage(err, t("skills.loadFailed")));
    }
  }

  function resetImportModal(): void {
    setImportOpen(false);
    setImportMode("markdown");
    setImportName("");
    setImportCategory("custom");
    setImportDescription("");
    setImportMarkdown("");
    setImportNameTouched(false);
    setImportDescriptionTouched(false);
    setImportSource("");
    setSourceCandidates([]);
    setSelectedSourceCandidateId("");
    setSourcePreviewed(false);
    setImportOverwrite(false);
    setImportError("");
  }

  async function finishSuccessfulImport(warning?: "gateway-restart-required", sourceImport = false): Promise<void> {
    resetImportModal();
    setSelectedDetail(null);
    setTab("installed");
    setPendingSkillChanges({});
    await loadInstalled();
    setNotice(
      warning === "gateway-restart-required"
        ? t(sourceImport ? "skills.sourceImportRestartWarning" : "skills.importRestartWarning")
        : t(sourceImport ? "skills.sourceImportSuccess" : "skills.importSuccess"),
    );
  }

  function handleImportNameChange(value: string): void {
    setImportNameTouched(true);
    setImportName(value);
  }

  function handleImportDescriptionChange(value: string): void {
    setImportDescriptionTouched(true);
    setImportDescription(value);
  }

  // Pasting/editing Markdown pre-fills Name and Description from the SKILL.md
  // frontmatter (or heading/first paragraph) unless the user has edited them.
  function handleImportMarkdownChange(value: string): void {
    setImportMarkdown(value);
    const meta = parseSkillMarkdownMeta(value);
    if (!importNameTouched && meta.name) setImportName(meta.name);
    if (!importDescriptionTouched && meta.description) setImportDescription(meta.description);
  }

  function handleImportSourceChange(value: string): void {
    setImportSource(value);
    setSourceCandidates([]);
    setSelectedSourceCandidateId("");
    setSourcePreviewed(false);
  }

  function handleSourceCandidateSelection(candidateId: string): void {
    setSelectedSourceCandidateId(candidateId);
    const candidate = sourceCandidates.find((item) => item.candidateId === candidateId);
    if (candidate) {
      setImportCategory(candidate.category || "custom");
    }
  }

  async function handlePreviewSkillSource(): Promise<void> {
    const source = importSource.trim();
    if (!source) {
      setImportError(t("skills.sourceRequired"));
      return;
    }

    setPreviewingSource(true);
    setSourcePreviewed(false);
    setSourceCandidates([]);
    setSelectedSourceCandidateId("");
    setImportError("");

    try {
      const result = await window.hermesAPI.previewSkillSource({ source });
      if (!result.success) {
        setImportError(result.error || t("skills.sourcePreviewFailed"));
        return;
      }

      setSourceCandidates(result.candidates);
      setSourcePreviewed(true);
      if (result.candidates.length === 1) {
        const [candidate] = result.candidates;
        setSelectedSourceCandidateId(candidate.candidateId);
        setImportCategory(candidate.category || "custom");
      }
    } catch (err) {
      setImportError(errorMessage(err, t("skills.sourcePreviewFailed")));
    } finally {
      setPreviewingSource(false);
    }
  }

  async function handleImportMarkdown(): Promise<void> {
    setImporting(true);
    setError("");
    setNotice("");
    setImportError("");

    if (Object.keys(pendingSkillChanges).length > 0) {
      const saved = await savePendingChanges();
      if (!saved) {
        setImportError(t("skills.importPendingSaveFailed"));
        setImporting(false);
        return;
      }
    }

    const request: SkillMarkdownImportRequest = {
      markdown: importMarkdown,
      name: importName.trim() || undefined,
      category: importCategory.trim() || undefined,
      description: importDescription.trim() || undefined,
      overwrite: importOverwrite,
    };
    try {
      const result = await window.hermesAPI.importSkillMarkdown(request, profile);

      if (!result.success) {
        setImportError(result.error);
        return;
      }

      await finishSuccessfulImport(result.warning);
    } catch (err) {
      setImportError((err as Error).message || t("skills.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  async function handleImportSkillSource(): Promise<void> {
    const source = importSource.trim();
    if (!source) {
      setImportError(t("skills.sourceRequired"));
      return;
    }

    if (!sourcePreviewed || sourceCandidates.length === 0) {
      setImportError(t("skills.sourcePreviewRequired"));
      return;
    }

    const candidateId =
      sourceCandidates.length === 1 ? sourceCandidates[0]?.candidateId : selectedSourceCandidateId;
    if (sourceCandidates.length > 1 && !candidateId) {
      setImportError(t("skills.candidateRequired"));
      return;
    }

    setImporting(true);
    setError("");
    setNotice("");
    setImportError("");

    if (Object.keys(pendingSkillChanges).length > 0) {
      const saved = await savePendingChanges();
      if (!saved) {
        setImportError(t("skills.importPendingSaveFailed"));
        setImporting(false);
        return;
      }
    }

    const request: SkillSourceImportRequest = {
      source,
      candidateId: candidateId || undefined,
      name: importName.trim() || undefined,
      category: importCategory.trim() || undefined,
      description: importDescription.trim() || undefined,
      overwrite: importOverwrite,
    };

    try {
      const result = await window.hermesAPI.importSkillSource(request, profile);

      if (!result.success) {
        if (result.code === "multiple-candidates" && result.candidates) {
          setSourceCandidates(result.candidates);
          setSourcePreviewed(true);
          setSelectedSourceCandidateId("");
        }
        setImportError(result.error);
        return;
      }

      await finishSuccessfulImport(result.warning, true);
    } catch (err) {
      setImportError(errorMessage(err, t("skills.sourceImportFailed")));
    } finally {
      setImporting(false);
    }
  }

  const installedItems: SkillListItem[] = useMemo(
    () =>
      installedSkills.map((skill) => {
        const pending = pendingForSkill(skill, pendingSkillChanges);
        return {
          source: "installed",
          name: skill.name,
          category: skill.category,
          description: skill.description,
          path: skill.path,
          directoryName: skill.directoryName,
          baseEnabled: true,
          enabled: pending ? pending.action === "install" : true,
          pendingAction: pending?.action,
          installedSkill: skill,
        };
      }),
    [installedSkills, pendingSkillChanges],
  );

  const bundledItems: SkillListItem[] = useMemo(
    () =>
      bundledSkills.map((skill) => {
        const exactInstalled = installedByKey.get(skillIdentityKey(skill));
        const fallbackInstalled = exactInstalled ?? installedSkills.find(
          (installed) =>
            !installed.category && normalizePart(installed.name) === normalizePart(skill.name),
        );
        const baseEnabled = Boolean(fallbackInstalled);
        const pending = pendingForSkill(
          {
            source: "bundled",
            name: skill.name,
            category: skill.category,
            description: skill.description,
            sourceLabel: skill.source,
            directoryName: skill.directoryName,
            baseEnabled,
            enabled: baseEnabled,
            installedSkill: fallbackInstalled,
          },
          pendingSkillChanges,
        );
        return {
          source: "bundled",
          name: skill.name,
          category: skill.category,
          description: skill.description,
          sourceLabel: skill.source,
          directoryName: skill.directoryName,
          baseEnabled,
          enabled: pending ? pending.action === "install" : baseEnabled,
          pendingAction: pending?.action,
          installedSkill: fallbackInstalled,
        };
      }),
    [bundledSkills, installedByKey, installedSkills, pendingSkillChanges],
  );

  const filteredInstalled = installedItems.filter((skill) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.category.toLowerCase().includes(q)
    );
  });

  const filteredBundled = bundledItems.filter((skill) => {
    let matches = true;
    if (search) {
      const q = search.toLowerCase();
      matches =
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.category.toLowerCase().includes(q);
    }
    if (categoryFilter) matches = matches && skill.category === categoryFilter;
    return matches;
  });

  const visibleGroups = groupSkills(tab === "installed" ? filteredInstalled : filteredBundled);
  const selectedKey = selectedDetail ? skillActionKey(selectedDetail.skill) : null;
  const importCategoryOptions = Array.from(
    new Set([...installedSkills, ...bundledSkills].map((s) => s.category).filter(Boolean)),
  ).sort();
  const categories = Array.from(new Set(bundledSkills.map((s) => s.category))).sort();

  function toggleCategory(category: string): void {
    setCollapsedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  if (loading) {
    return (
      <div className="skills-container">
        <div className="skills-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="skills-container" ref={scrollContainerRef}>
      <SkillModals
        values={{
          t,
          importOpen,
          setImportOpen,
          importMode,
          setImportMode,
          remoteOnlyMode: remoteOnlyMode === true,
          sourceTabsAvailable: remoteOnlyMode === false,
          importName,
          setImportName: handleImportNameChange,
          importCategory,
          setImportCategory,
          importCategoryOptions,
          importDescription,
          setImportDescription: handleImportDescriptionChange,
          importMarkdown,
          setImportMarkdown: handleImportMarkdownChange,
          importSource,
          setImportSource: handleImportSourceChange,
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
        }}
      />

      <div className="skills-header">
        <div>
          <h2 className="skills-title">{t("skills.title")}</h2>
          <p className="skills-subtitle">{t("skills.subtitle")}</p>
        </div>
        <div className="skills-header-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              resetImportModal();
              setImportOpen(true);
            }}
            disabled={savingDraft}
          >
            <Plus size={14} />
            {t("skills.addSkillAction")}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadAll} disabled={savingDraft}>
            <Refresh size={14} />
            {t("skills.refresh")}
          </button>
        </div>
      </div>

      {notice && (
        <div className="skills-notice">
          {notice}
          <button className="btn-ghost" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="skills-error">
          {error}
          <button className="btn-ghost" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="skills-draft-bar">
          <div className="skills-draft-copy">
            <div className="skills-draft-title">{t("skills.pendingChanges")}</div>
            <div className="skills-draft-summary">
              {t("skills.pendingSummary", {
                enable: pendingEnableCount,
                disable: pendingDisableCount,
              })}
            </div>
            <div className="skills-draft-help">{t("skills.pendingHelp")}</div>
          </div>
          <div className="skills-draft-actions">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={handleDiscardDraft}
              disabled={savingDraft}
            >
              {t("skills.discardChanges")}
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={handleSaveDraft}
              disabled={savingDraft}
            >
              {savingDraft ? t("skills.savingChanges") : t("skills.saveChanges")}
            </button>
          </div>
        </div>
      )}

      {selectedDetail ? (
        <SkillDetailPanel
          detail={selectedDetail}
          saving={savingDraft}
          onBack={handleBackToSkillList}
          onDisable={handleDisableSkill}
          t={t}
        />
      ) : (
        <>
          <div className="skills-tabs">
            <button
              className={`skills-tab ${tab === "installed" ? "active" : ""}`}
              onClick={() => setTab("installed")}
            >
              {t("skills.installedTab")} ({installedSkills.length})
            </button>
            <button
              className={`skills-tab ${tab === "browse" ? "active" : ""}`}
              onClick={() => setTab("browse")}
            >
              {t("skills.browseTab")} ({bundledSkills.length})
            </button>
          </div>

          <div className="skills-search">
            <Search size={15} />
            <input
              ref={searchRef}
              className="skills-search-input"
              type="text"
              placeholder={
                tab === "installed" ? t("skills.filterInstalled") : t("skills.search")
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="btn-ghost skills-search-clear"
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {tab === "browse" && categories.length > 0 && (
            <div className="skills-category-pills">
              <button
                className={`skills-pill ${categoryFilter === null ? "active" : ""}`}
                onClick={() => setCategoryFilter(null)}
              >
                {t("skills.all")}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`skills-pill ${categoryFilter === cat ? "active" : ""}`}
                  onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {visibleGroups.length === 0 ? (
            <div className="skills-empty">
              <p className="skills-empty-text">
                {tab === "installed"
                  ? search
                    ? t("skills.noMatchingInstalled")
                    : t("skills.noInstalled")
                  : t("skills.noBrowseResults")}
              </p>
              <p className="skills-empty-hint">
                {tab === "installed"
                  ? search
                    ? t("skills.noMatchingHint")
                    : t("skills.noInstalledHint")
                  : t("skills.noBrowseResultsHint")}
              </p>
            </div>
          ) : (
            <div className="skills-category-list">
              {visibleGroups.map((group) => (
                <SkillCategorySection
                  key={group.category}
                  category={group.category}
                  skills={group.skills}
                  collapsed={Boolean(collapsedCategories[group.category])}
                  enabledCount={group.enabledCount}
                  totalCount={group.totalCount}
                  pendingCount={group.pendingCount}
                  saving={savingDraft}
                  selectedKey={selectedKey}
                  onToggleCollapsed={toggleCategory}
                  onOpenDetail={handleViewDetail}
                  onEnableSkill={handleInstallSkill}
                  onDisableSkill={handleDisableSkill}
                  onUndoPendingChange={removePendingForSkill}
                  onEnableCategory={(category, skills) => handleCategoryAction(category, skills, "enable")}
                  onDisableCategory={(category, skills) => handleCategoryAction(category, skills, "disable")}
                  skillKey={skillActionKey}
                  t={t}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Skills;
