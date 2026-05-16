import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, X, Refresh, Plus } from "../../assets/icons";
import { SkillModals } from "./components/SkillModals";
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
import type { SkillMarkdownImportRequest } from "../../../../shared/skills";

interface BundledSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

interface ProfileInfo {
  name: string;
  isDefault: boolean;
}

interface SkillsProps {
  profile?: string;
}

type Tab = "installed" | "browse";

type GroupedSkills = Array<{
  category: string;
  skills: SkillListItem[];
  enabledCount: number;
  totalCount: number;
}>;

function normalizePart(value: string): string {
  return value.trim().toLowerCase();
}

function skillKey(skill: { category: string; name: string }): string {
  return `${normalizePart(skill.category)}\u0000${normalizePart(skill.name)}`;
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
    }));
}

function selectedProfileName(profile?: string): string {
  return profile || "default";
}

function Skills({ profile }: SkillsProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("installed");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<SelectedSkillDetail | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [bulkActionInProgress, setBulkActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState("");
  const [importCategory, setImportCategory] = useState("custom");
  const [importDescription, setImportDescription] = useState("");
  const [importMarkdown, setImportMarkdown] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRequestRef = useRef(0);

  const loadInstalled = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listInstalledSkills(profile);
    setInstalledSkills(list);
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
    void Promise.resolve().then(() => loadAll());
  }, [loadAll]);

  const installedByKey = useMemo(() => {
    const map = new Map<string, InstalledSkill>();
    for (const skill of installedSkills) map.set(skillKey(skill), skill);
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
        return skills.some((candidate) => skillKey(candidate) === skillKey(skill))
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
    if (!installedSkill) {
      setNotice(t("skills.detailUnavailableForBundled"));
      return;
    }

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
      if (!current || skillKey(current.skill) !== skillKey(installedSkill)) return current;
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

  async function handleInstallSkill(skill: SkillListItem): Promise<void> {
    const key = skillKey(skill);
    setActionInProgress(key);
    setError("");
    setNotice("");
    try {
      const result = await window.hermesAPI.installSkill(skill.name, profile);
      if (result.success) {
        await loadInstalled();
        setNotice(t("skills.skillEnabled", { name: skill.name }));
      } else {
        setError(result.error || t("skills.installFailed"));
      }
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleDisableSkill(skill: SkillListItem | InstalledSkill): Promise<void> {
    const installedSkill = "installedSkill" in skill ? skill.installedSkill : skill;
    const targetName = installedSkill?.name || skill.name;
    const key = skillKey(skill);
    setActionInProgress(key);
    setError("");
    setNotice("");
    try {
      const result = await window.hermesAPI.uninstallSkill(targetName, profile);
      if (result.success) {
        if (selectedDetail && skillKey(selectedDetail.skill) === key) {
          setSelectedDetail(null);
        }
        await loadInstalled();
        setNotice(t("skills.skillDisabled", { name: targetName }));
      } else {
        setError(result.error || t("skills.uninstallFailed"));
      }
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleCategoryAction(
    category: string,
    skills: SkillListItem[],
    action: "enable" | "disable",
  ): Promise<void> {
    const targets = skills.filter((skill) => (action === "enable" ? !skill.enabled : skill.enabled));
    if (targets.length === 0) return;

    setBulkActionInProgress(`${category}:${action}`);
    setError("");
    setNotice("");
    let updated = 0;
    const failures: string[] = [];

    for (const target of targets) {
      try {
        const result = action === "enable"
          ? await window.hermesAPI.installSkill(target.name, profile)
          : await window.hermesAPI.uninstallSkill(target.installedSkill?.name || target.name, profile);
        if (result.success) {
          updated += 1;
        } else {
          failures.push(target.name);
        }
      } catch {
        failures.push(target.name);
      }
    }

    setBulkActionInProgress(null);
    try {
      await loadInstalled();
    } catch (err) {
      setError((err as Error).message || t("skills.loadFailed"));
    }

    if (updated > 0) {
      setNotice(t("skills.bulkActionSucceeded", { count: updated }));
    }
    if (failures.length > 0) {
      setError(t("skills.bulkActionFailed", { names: failures.join(", ") }));
    }
  }

  async function handleImportMarkdown(): Promise<void> {
    setImporting(true);
    setError("");
    setNotice("");
    setImportError("");
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

      setImportOpen(false);
      setImportName("");
      setImportCategory("custom");
      setImportDescription("");
      setImportMarkdown("");
      setImportOverwrite(false);
      setImportError("");
      setSelectedDetail(null);
      setTab("installed");
      await loadInstalled();
      setNotice(
        result.warning === "gateway-restart-required"
          ? t("skills.importRestartWarning")
          : t("skills.importSuccess"),
      );
    } catch (err) {
      setImportError((err as Error).message || t("skills.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  const installedItems: SkillListItem[] = useMemo(
    () =>
      installedSkills.map((skill) => ({
        source: "installed",
        name: skill.name,
        category: skill.category,
        description: skill.description,
        path: skill.path,
        enabled: true,
        installedSkill: skill,
      })),
    [installedSkills],
  );

  const bundledItems: SkillListItem[] = useMemo(
    () =>
      bundledSkills.map((skill) => {
        const exactInstalled = installedByKey.get(skillKey(skill));
        const fallbackInstalled = exactInstalled ?? installedSkills.find(
          (installed) =>
            !installed.category && normalizePart(installed.name) === normalizePart(skill.name),
        );
        return {
          source: "bundled",
          name: skill.name,
          category: skill.category,
          description: skill.description,
          sourceLabel: skill.source,
          enabled: Boolean(fallbackInstalled),
          installedSkill: fallbackInstalled,
        };
      }),
    [bundledSkills, installedByKey, installedSkills],
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
  const selectedKey = selectedDetail ? skillKey(selectedDetail.skill) : null;
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
    <div className="skills-container">
      <SkillModals
        values={{
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
              setImportError("");
              setImportOpen(true);
            }}
          >
            <Plus size={14} />
            {t("skills.importMarkdownAction")}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadAll}>
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

      {selectedDetail ? (
        <SkillDetailPanel
          detail={selectedDetail}
          actionInProgress={actionInProgress}
          onBack={() => setSelectedDetail(null)}
          onDisable={handleDisableSkill}
          skillKey={skillKey}
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
                  actionInProgress={actionInProgress}
                  bulkActionInProgress={bulkActionInProgress}
                  selectedKey={selectedKey}
                  onToggleCollapsed={toggleCategory}
                  onOpenDetail={handleViewDetail}
                  onEnableSkill={handleInstallSkill}
                  onDisableSkill={handleDisableSkill}
                  onEnableCategory={(category, skills) => handleCategoryAction(category, skills, "enable")}
                  onDisableCategory={(category, skills) => handleCategoryAction(category, skills, "disable")}
                  skillKey={skillKey}
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
