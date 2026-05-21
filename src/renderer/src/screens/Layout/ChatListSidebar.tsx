import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChatBubble, Clock, Plus, Users } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { useCachedSessions } from "../Sessions/useCachedSessions";
import {
  formatSessionFullDate,
  formatSessionModel,
  formatSessionProfile,
  isActiveSession,
  sessionRowKey,
  type CachedSession,
} from "../Sessions/sessionListUtils";

type ProfileSummary = Awaited<
  ReturnType<Window["hermesAPI"]["listProfiles"]>
>[number];

type ChatSidebarListMode = "agents" | "all";

interface ChatListSidebarProps {
  activeProfile: string;
  currentSessionId: string | null;
  currentSessionProfile?: string | null;
  refreshToken?: number;
  onBack: () => void;
  onResumeSession: (
    sessionId: string,
    title?: string | null,
    profile?: string,
  ) => Promise<void> | void;
  onStartNewChat: (profile: string) => Promise<void> | void;
}

interface AgentGroup {
  key: string;
  name: string;
  sessions: CachedSession[];
  isUnknown: boolean;
}

function fallbackProfile(name: string): ProfileSummary {
  return {
    name: name.trim() || "default",
    path: "",
    isDefault: name.trim() === "default" || !name.trim(),
    isActive: true,
    model: "",
    provider: "",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: false,
  };
}

function sortProfiles(
  profiles: ProfileSummary[],
  activeProfile: string,
): ProfileSummary[] {
  const active = activeProfile.trim() || "default";
  return [...profiles].sort((a, b) => {
    const aName = a.name.trim() || "default";
    const bName = b.name.trim() || "default";
    if (aName === active && bName !== active) return -1;
    if (bName === active && aName !== active) return 1;
    if (aName === "default" && bName !== "default") return -1;
    if (bName === "default" && aName !== "default") return 1;
    return aName.localeCompare(bName);
  });
}

function buildAgentGroups(
  profiles: ProfileSummary[],
  sessions: CachedSession[],
  activeProfile: string,
  unknownAgentLabel: string,
): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();

  for (const profile of profiles) {
    const name = profile.name.trim() || "default";
    groups.set(name, { key: name, name, sessions: [], isUnknown: false });
  }

  for (const session of sessions) {
    const profile = session.profile?.trim();
    const key = profile || "__unknown__";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: profile || unknownAgentLabel,
        sessions: [],
        isUnknown: !profile,
      });
    }
    groups.get(key)!.sessions.push(session);
  }

  for (const group of groups.values()) {
    group.sessions.sort((a, b) => b.startedAt - a.startedAt);
  }

  const active = activeProfile.trim() || "default";
  return [...groups.values()].sort((a, b) => {
    if (a.key === active && b.key !== active) return -1;
    if (b.key === active && a.key !== active) return 1;

    const aLatest = a.sessions[0]?.startedAt ?? 0;
    const bLatest = b.sessions[0]?.startedAt ?? 0;
    if (aLatest !== bLatest) return bLatest - aLatest;

    return a.name.localeCompare(b.name);
  });
}

function ChatListSidebar({
  activeProfile,
  currentSessionId,
  currentSessionProfile,
  refreshToken,
  onBack,
  onResumeSession,
  onStartNewChat,
}: ChatListSidebarProps): React.JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<ChatSidebarListMode>("agents");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([
    fallbackProfile(activeProfile),
  ]);
  const [profilesError, setProfilesError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [startingProfile, setStartingProfile] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { sessions, loading, error, reload } = useCachedSessions({
    limit: 100,
    refreshToken,
  });

  useEffect(() => {
    let cancelled = false;
    async function loadProfiles(): Promise<void> {
      try {
        const listed = await window.hermesAPI.listProfiles();
        if (cancelled) return;
        setProfiles(
          listed.length > 0 ? listed : [fallbackProfile(activeProfile)],
        );
        setProfilesError(false);
      } catch {
        if (cancelled) return;
        setProfiles([fallbackProfile(activeProfile)]);
        setProfilesError(true);
      }
    }
    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [activeProfile]);

  const sortedProfiles = useMemo(
    () => sortProfiles(profiles, activeProfile),
    [activeProfile, profiles],
  );
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.startedAt - a.startedAt),
    [sessions],
  );
  const agentGroups = useMemo(
    () =>
      buildAgentGroups(
        sortedProfiles,
        sessions,
        activeProfile,
        t("chat.sidebarUnknownAgent"),
      ),
    [activeProfile, sessions, sortedProfiles, t],
  );

  const startNewChat = async (profile: string): Promise<void> => {
    const cleanProfile = profile.trim() || "default";
    setStartingProfile(cleanProfile);
    setStartError(null);
    try {
      await onStartNewChat(cleanProfile);
      setPickerOpen(false);
    } catch {
      setStartError(t("chat.sidebarStartFailed"));
    } finally {
      setStartingProfile(null);
    }
  };

  const renderRow = (session: CachedSession): React.JSX.Element => {
    const active = isActiveSession(
      currentSessionId,
      currentSessionProfile,
      session.id,
      session.profile,
    );
    const title = session.title || t("chat.untitledChat");
    return (
      <button
        key={sessionRowKey(session.id, session.profile)}
        className={`chat-sidebar-row ${active ? "chat-sidebar-row--active" : ""}`}
        onClick={() => onResumeSession(session.id, session.title, session.profile)}
      >
        <span className="chat-sidebar-row-title">{title}</span>
        <span className="chat-sidebar-row-meta">
          {formatSessionFullDate(session.startedAt)}
        </span>
        <span className="chat-sidebar-row-tags">
          <span>{formatSessionProfile(session.profile, t("chat.sidebarUnknownAgent"))}</span>
          <span>
            {session.messageCount} {session.messageCount === 1 ? "msg" : "msgs"}
          </span>
          {session.model ? <span>{formatSessionModel(session.model)}</span> : null}
        </span>
      </button>
    );
  };

  const renderCount = (count: number): string =>
    count === 1
      ? t("chat.sidebarChatCountOne")
      : t("chat.sidebarChatCount", { count });

  const renderBody = (): React.JSX.Element => {
    if (loading && sessions.length === 0) {
      return (
        <div className="chat-sidebar-empty">
          <div className="loading-spinner" />
          <span>{t("chat.sidebarLoading")}</span>
        </div>
      );
    }

    if (error && sessions.length === 0) {
      return (
        <div className="chat-sidebar-error">
          <p>{t("chat.sidebarLoadError")}</p>
          <button onClick={() => void reload()}>{t("chat.sidebarRetry")}</button>
        </div>
      );
    }

    if (mode === "all") {
      if (sortedSessions.length === 0) {
        return (
          <div className="chat-sidebar-empty">
            <ChatBubble size={26} />
            <span>{t("chat.sidebarEmptyAll")}</span>
          </div>
        );
      }
      return <div className="chat-sidebar-list">{sortedSessions.map(renderRow)}</div>;
    }

    if (agentGroups.length === 0) {
      return (
        <div className="chat-sidebar-empty">
          <Users size={26} />
          <span>{t("chat.sidebarEmptyAgents")}</span>
        </div>
      );
    }

    return (
      <div className="chat-sidebar-agent-list">
        {agentGroups.map((group) => (
          <section key={group.key} className="chat-sidebar-agent-group">
            <div className="chat-sidebar-agent-header">
              <div>
                <div className="chat-sidebar-agent-name">{group.name}</div>
                <div className="chat-sidebar-agent-count">
                  {renderCount(group.sessions.length)}
                </div>
              </div>
              {!group.isUnknown ? (
                <button
                  className="chat-sidebar-agent-new"
                  onClick={() => void startNewChat(group.name)}
                  disabled={startingProfile !== null}
                  title={t("chat.sidebarStartWithAgent", { agent: group.name })}
                >
                  <Plus size={13} />
                </button>
              ) : null}
            </div>
            {group.sessions.length > 0 ? (
              <div className="chat-sidebar-list">
                {group.sessions.map(renderRow)}
              </div>
            ) : (
              <div className="chat-sidebar-agent-empty">
                {t("chat.sidebarEmptyAgent")}
              </div>
            )}
          </section>
        ))}
      </div>
    );
  };

  return (
    <aside className="sidebar chat-list-sidebar">
      <div className="chat-sidebar-header">
        <button className="chat-sidebar-back" onClick={onBack}>
          <ArrowLeft size={15} />
          {t("chat.sidebarBack")}
        </button>
        <div className="chat-sidebar-title">{t("chat.sidebarTitle")}</div>
        <button
          className="chat-sidebar-new"
          onClick={() => {
            setPickerOpen((value) => !value);
            setStartError(null);
          }}
        >
          <Plus size={15} />
          {t("chat.sidebarNewChat")}
        </button>
      </div>

      {pickerOpen ? (
        <div className="chat-sidebar-profile-picker">
          <div className="chat-sidebar-profile-title">
            {t("chat.sidebarPickAgent")}
          </div>
          {profilesError ? (
            <div className="chat-sidebar-profile-warning">
              {t("chat.sidebarProfilesUnavailable")}
            </div>
          ) : null}
          {startError ? (
            <div className="chat-sidebar-profile-warning">{startError}</div>
          ) : null}
          <div className="chat-sidebar-profile-options">
            {sortedProfiles.map((profile) => {
              const name = profile.name.trim() || "default";
              return (
                <button
                  key={name}
                  className="chat-sidebar-profile-option"
                  onClick={() => void startNewChat(name)}
                  disabled={startingProfile !== null}
                >
                  <span>{name}</span>
                  {startingProfile === name ? (
                    <span>{t("common.loading")}</span>
                  ) : profile.model ? (
                    <span>{formatSessionModel(profile.model)}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="chat-sidebar-toggle" role="group">
        <button
          aria-pressed={mode === "agents"}
          className={mode === "agents" ? "active" : ""}
          onClick={() => setMode("agents")}
        >
          <Users size={14} />
          {t("chat.sidebarModeAgents")}
        </button>
        <button
          aria-pressed={mode === "all"}
          className={mode === "all" ? "active" : ""}
          onClick={() => setMode("all")}
        >
          <Clock size={14} />
          {t("chat.sidebarModeAll")}
        </button>
      </div>

      <div className="chat-sidebar-body">{renderBody()}</div>
    </aside>
  );
}

export default ChatListSidebar;
