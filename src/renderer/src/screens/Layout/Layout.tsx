import { useState, useCallback, useEffect } from "react";
import Chat, { ChatMessage } from "../Chat/Chat";
import Sessions from "../Sessions/Sessions";
import TraceLab from "../TraceLab/TraceLab";
import Agents from "../Agents/Agents";
import Settings from "../Settings/Settings";
import Skills from "../Skills/Skills";
import Soul from "../Soul/Soul";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Models from "../Models/Models";
import Providers from "../Providers/Providers";
import Schedules from "../Schedules/Schedules";
import RemoteNotice from "../../components/RemoteNotice";
import MercuryLockup from "../../components/common/MercuryLockup";
import {
  ChatBubble,
  Clock,
  Users,
  Settings as SettingsIcon,
  Puzzle,
  Sparkles,
  Brain,
  Wrench,
  Signal,
  Layers,
  KeyRound,
  Timer,
  Download,
  Activity,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { markRendererPerf } from "../../perf";

type View =
  | "chat"
  | "sessions"
  | "traceDetail"
  | "agents"
  | "models"
  | "providers"
  | "skills"
  | "soul"
  | "memory"
  | "tools"
  | "schedules"
  | "gateway"
  | "settings";

type NavView = Exclude<View, "traceDetail">;

type TraceLaunchState =
  | { mode: "all" }
  | {
      mode: "session";
      target: {
        sessionId: string;
        title?: string | null;
        profile?: string | null;
      };
    };

const NAV_ITEMS: { view: NavView; icon: LucideIcon; labelKey: string }[] = [
  { view: "chat", icon: ChatBubble, labelKey: "navigation.chat" },
  { view: "sessions", icon: Clock, labelKey: "navigation.sessions" },
  { view: "agents", icon: Users, labelKey: "navigation.agents" },
  { view: "models", icon: Layers, labelKey: "navigation.models" },
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "skills", icon: Puzzle, labelKey: "navigation.skills" },
  { view: "soul", icon: Sparkles, labelKey: "navigation.soul" },
  { view: "memory", icon: Brain, labelKey: "navigation.memory" },
  { view: "tools", icon: Wrench, labelKey: "navigation.tools" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
  { view: "settings", icon: SettingsIcon, labelKey: "navigation.settings" },
];

function Layout(): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null);
  const [currentSessionProfile, setCurrentSessionProfile] = useState<string | null>(null);
  const [sessionsRefreshToken, setSessionsRefreshToken] = useState(0);
  const [conversationVersion, setConversationVersion] = useState(0);
  const [activeProfile, setActiveProfile] = useState("default");
  const [traceLaunch, setTraceLaunch] = useState<TraceLaunchState>({ mode: "all" });
  const [traceLaunchVersion, setTraceLaunchVersion] = useState(0);
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat"]),
  );
  // Remote-only mode — SSH tunnel has full access; only pure HTTP remote mode restricts screens
  const [remoteMode, setRemoteMode] = useState(false);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
  }, []);

  useEffect(() => {
    markRendererPerf("startup", "layout.mounted", {
      initialView: view,
      visitedCount: visitedViews.size,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markRendererPerf("startup", "layout.route.changed", {
      view,
      visitedCount: visitedViews.size,
    });
  }, [view, visitedViews.size]);

  // Re-check remote mode on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  // Mercury desktop app update state. This is separate from the Hermes Agent
  // engine updater in Settings.
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "current"
    | "error"
  >("idle");
  const [downloadPercent, setDownloadPercent] = useState(0);

  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
      setUpdateState("available");
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setDownloadPercent(info.percent);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
    });
    const cleanupNotAvailable = window.hermesAPI.onUpdateNotAvailable(() => {
      if (updateState === "checking") setUpdateState("current");
    });
    const cleanupError = window.hermesAPI.onUpdateError(() => {
      if (updateState === "checking" || updateState === "downloading") {
        setUpdateState("error");
      }
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupNotAvailable();
      cleanupError();
    };
  }, [updateState]);

  async function handleUpdate(): Promise<void> {
    if (updateState === "checking" || updateState === "downloading") return;

    if (updateState === "available") {
      setUpdateState("downloading");
      await window.hermesAPI.downloadUpdate();
      return;
    }

    if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
      return;
    }

    setUpdateState("checking");
    const version = await window.hermesAPI.checkForUpdates();
    if (version) {
      setUpdateVersion(version);
      setUpdateState("available");
    } else {
      setUpdateState("current");
    }
  }

  const updateDisabled = updateState === "checking" || updateState === "downloading";
  const updateButtonLabel =
    updateState === "checking"
      ? t("common.checkingForUpdates")
      : updateState === "available"
      ? t("common.updateMercuryVersion", { version: updateVersion })
      : updateState === "downloading"
      ? t("common.downloading", { percent: downloadPercent })
      : updateState === "ready"
      ? t("common.restartToUpdate")
      : updateState === "current"
      ? t("common.mercuryUpToDate")
      : updateState === "error"
      ? t("common.updateCheckFailed")
      : t("common.updateMercury");

  const handleNewChat = useCallback(() => {
    // Abort any in-flight chat before clearing
    window.hermesAPI.abortChat();
    setMessages([]);
    setCurrentSessionId(null);
    setCurrentSessionTitle(null);
    setCurrentSessionProfile(null);
    setConversationVersion((value) => value + 1);
    goTo("chat");
  }, [goTo]);

  // Listen for menu IPC events (Cmd+N, Cmd+K from app menu)
  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewChat();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      goTo("sessions");
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
    };
  }, [handleNewChat, goTo]);

  const handleSelectProfile = useCallback((name: string) => {
    setActiveProfile(name);
    setMessages([]);
    setCurrentSessionId(null);
    setCurrentSessionTitle(null);
    setCurrentSessionProfile(null);
    setConversationVersion((value) => value + 1);
  }, []);

  const handleOpenSessionTrace = useCallback(
    (sessionId: string, title?: string | null, profile?: string | null) => {
      const rowProfile = profile?.trim() || activeProfile;
      setTraceLaunch({
        mode: "session",
        target: { sessionId, title: title ?? null, profile: rowProfile },
      });
      setTraceLaunchVersion((value) => value + 1);
      goTo("traceDetail");
    },
    [activeProfile, goTo],
  );

  const handleOpenTraceActivity = useCallback(() => {
    setTraceLaunch({ mode: "all" });
    setTraceLaunchVersion((value) => value + 1);
    goTo("traceDetail");
  }, [goTo]);

  const handleBackToSessions = useCallback(() => {
    goTo("sessions");
  }, [goTo]);

  const handleResumeSession = useCallback(
    async (sessionId: string, title?: string | null, profile?: string) => {
      const rowProfile = profile?.trim() || undefined;
      const nextProfile = rowProfile || activeProfile;
      const dbMessages = await window.hermesAPI.getSessionMessages(sessionId, rowProfile);
      const chatMessages: ChatMessage[] = dbMessages.map((m) => ({
        id: `db-${m.id}`,
        role: m.role === "user" ? "user" : "agent",
        content: m.content,
      }));
      if (rowProfile) setActiveProfile(rowProfile);
      setMessages(chatMessages);
      setCurrentSessionId(sessionId);
      setCurrentSessionTitle(title?.trim() || null);
      setCurrentSessionProfile(nextProfile);
      setConversationVersion((value) => value + 1);
      goTo("chat");
    },
    [activeProfile, goTo],
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <MercuryLockup className="sidebar-brand-lockup" />
        </div>

        <div className="sidebar-update-panel">
          <button
            className={`sidebar-update-btn sidebar-update-${updateState}`}
            onClick={handleUpdate}
            disabled={updateDisabled}
          >
            <Download size={13} />
            <span>{updateButtonLabel}</span>
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => (
            <button
              key={v}
              className={`sidebar-nav-item ${view === v || (view === "traceDetail" && v === "sessions") ? "active" : ""}`}
              onClick={() => goTo(v)}
            >
              <Icon size={16} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-text">
            {activeProfile === "default" ? t("common.appName") : activeProfile}
          </div>
        </div>
      </aside>

      <main className="content">
        <div style={paneStyle("chat")}>
          <Chat
            messages={messages}
            setMessages={setMessages}
            sessionId={currentSessionId}
            sessionTitle={currentSessionTitle}
            conversationVersion={conversationVersion}
            profile={activeProfile}
            onSessionResolved={(sessionId) => {
              setCurrentSessionId(sessionId);
              setCurrentSessionProfile(activeProfile);
            }}
            onSessionTitleChange={(title) => {
              setCurrentSessionTitle(title);
              setSessionsRefreshToken((value) => value + 1);
            }}
            onSessionReset={() => {
              setCurrentSessionId(null);
              setCurrentSessionTitle(null);
              setCurrentSessionProfile(null);
              setConversationVersion((value) => value + 1);
            }}
            onNewChat={handleNewChat}
          />
        </div>

        {visitedViews.has("sessions") && (
          <div style={paneStyle("sessions")}>
            {remoteMode ? (
              <div className="sessions-container">
                <div className="sessions-header">
                  <div className="sessions-header-top">
                    <h2 className="sessions-title">{t("sessions.title")}</h2>
                    <div className="sessions-header-actions">
                      <button className="btn btn-secondary" onClick={handleOpenTraceActivity}>
                        <Activity size={14} />
                        {t("sessions.traceActivity")}
                      </button>
                    </div>
                  </div>
                </div>
                <RemoteNotice feature="Sessions" />
              </div>
            ) : (
              <Sessions
                onResumeSession={handleResumeSession}
                onOpenSessionTrace={handleOpenSessionTrace}
                onOpenTraceActivity={handleOpenTraceActivity}
                onNewChat={handleNewChat}
                currentSessionId={currentSessionId}
                currentSessionProfile={currentSessionProfile}
                refreshToken={sessionsRefreshToken}
              />
            )}
          </div>
        )}

        {visitedViews.has("traceDetail") && (
          <div style={paneStyle("traceDetail")}>
            <TraceLab
              mode={traceLaunch.mode}
              sessionTarget={traceLaunch.mode === "session" ? traceLaunch.target : null}
              reloadToken={traceLaunchVersion}
              onBackToSessions={handleBackToSessions}
            />
          </div>
        )}

        {visitedViews.has("agents") && (
          <div style={paneStyle("agents")}>
            {remoteMode ? (
              <RemoteNotice feature="Profiles" />
            ) : (
              <Agents
                activeProfile={activeProfile}
                onSelectProfile={handleSelectProfile}
                onProfileAction={goTo}
              />
            )}
          </div>
        )}

        {visitedViews.has("models") && (
          <div style={paneStyle("models")}>
            <Models />
          </div>
        )}

        {visitedViews.has("providers") && (
          <div style={paneStyle("providers")}>
            {remoteMode ? (
              <RemoteNotice feature="Providers" />
            ) : (
              <Providers
                profile={activeProfile}
                visible={view === "providers"}
              />
            )}
          </div>
        )}

        {visitedViews.has("skills") && (
          <div style={paneStyle("skills")}>
            {remoteMode ? (
              <RemoteNotice feature="Skills" />
            ) : (
              <Skills profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("soul") && (
          <div style={paneStyle("soul")}>
            {remoteMode ? (
              <RemoteNotice feature="Persona" />
            ) : (
              <Soul profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("memory") && (
          <div style={paneStyle("memory")}>
            {remoteMode ? (
              <RemoteNotice feature="Memory" />
            ) : (
              <Memory profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("tools") && (
          <div style={paneStyle("tools")}>
            {remoteMode ? (
              <RemoteNotice feature="Tools" />
            ) : (
              <Tools profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("schedules") && (
          <div style={paneStyle("schedules")}>
            <Schedules profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("gateway") && (
          <div style={paneStyle("gateway")}>
            {remoteMode ? (
              <RemoteNotice feature="Gateway" />
            ) : (
              <Gateway profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("settings") && (
          <div style={paneStyle("settings")}>
            <Settings profile={activeProfile} />
          </div>
        )}
      </main>
    </div>
  );
}

export default Layout;
