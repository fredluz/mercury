import { useState, useCallback, useEffect, useRef } from "react";
import Chat, {
  ChatMessage,
  type ChatScheduleConversationDraft,
} from "../Chat/Chat";
import Sessions from "../Sessions/Sessions";
import ChatListSidebar from "./ChatListSidebar";
import ChatAgentPicker from "./ChatAgentPicker";
import TraceLab from "../TraceLab/TraceLab";
import Agents from "../Agents/Agents";
import Settings from "../Settings/Settings";
import Skills from "../Skills/Skills";
import Soul from "../Soul/Soul";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Providers from "../Providers/Providers";
import Schedules, { type ScheduleInitialDraft } from "../Schedules/Schedules";
import RemoteNotice from "../../components/RemoteNotice";
import { RuntimeDiagnosticNotice } from "../../components/RuntimeDiagnosticNotice";
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
  KeyRound,
  Timer,
  Activity,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import type { RuntimeDiagnostic } from "../../../../shared/runtime";
import { useI18n } from "../../components/useI18n";
import { markRendererPerf } from "../../perf";

type View =
  | "chat"
  | "sessions"
  | "traceDetail"
  | "agents"
  | "providers"
  | "skills"
  | "soul"
  | "memory"
  | "tools"
  | "schedules"
  | "gateway"
  | "settings";

type NavView = Exclude<View, "traceDetail">;
type SidebarMode = "main" | "chatList";

type TraceLaunchState =
  | { mode: "all" }
  | {
      mode: "session";
      target: {
        sessionId: string;
        title?: string | null;
        profile?: string | null;
      };
    }
  | {
      mode: "run";
      target: {
        runId: string;
      };
    };

const NAV_ITEMS: { view: NavView; icon: LucideIcon; labelKey: string }[] = [
  { view: "chat", icon: ChatBubble, labelKey: "navigation.chat" },
  { view: "sessions", icon: Clock, labelKey: "navigation.sessions" },
  { view: "agents", icon: Users, labelKey: "navigation.agents" },
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "skills", icon: Puzzle, labelKey: "navigation.skills" },
  { view: "soul", icon: Sparkles, labelKey: "navigation.soul" },
  { view: "memory", icon: Brain, labelKey: "navigation.memory" },
  { view: "tools", icon: Wrench, labelKey: "navigation.tools" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
  { view: "settings", icon: SettingsIcon, labelKey: "navigation.settings" },
];

function isIdleLocalUnverifiedRuntime(
  diagnostic: RuntimeDiagnostic | null,
): boolean {
  return Boolean(
    diagnostic &&
    diagnostic.status === "unverified" &&
    diagnostic.mode === "local" &&
    diagnostic.actualProfile === null &&
    !diagnostic.startedByMercury &&
    !diagnostic.stale,
  );
}

function Layout(): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>("chat");
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("main");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(
    null,
  );
  const [currentSessionProfile, setCurrentSessionProfile] = useState<
    string | null
  >(null);
  const [sessionsRefreshToken, setSessionsRefreshToken] = useState(0);
  const [conversationVersion, setConversationVersion] = useState(0);
  const [activeProfile, setActiveProfile] = useState("default");
  const [showChatAgentPicker, setShowChatAgentPicker] = useState(false);
  const [traceLaunch, setTraceLaunch] = useState<TraceLaunchState>({
    mode: "all",
  });
  const [traceLaunchVersion, setTraceLaunchVersion] = useState(0);
  const [agentReturnViews, setAgentReturnViews] = useState<Set<View>>(
    () => new Set<View>(),
  );
  const [scheduleInitialDraft, setScheduleInitialDraft] =
    useState<ScheduleInitialDraft | null>(null);
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat"]),
  );
  // Remote-only mode — SSH tunnel has full access; only pure HTTP remote mode restricts screens
  const [remoteMode, setRemoteMode] = useState<boolean | null>(null);
  const [runtimeDiagnostic, setRuntimeDiagnostic] =
    useState<RuntimeDiagnostic | null>(null);
  const activeProfileRef = useRef(activeProfile);
  const resumeRequestIdRef = useRef(0);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
    if (v !== "chat") setSidebarMode("main");
  }, []);

  const openChatListSidebar = useCallback(() => {
    goTo("chat");
    if (remoteMode === false) {
      setSidebarMode("chatList");
      return;
    }
    if (remoteMode === null) {
      void window.hermesAPI
        .isRemoteOnlyMode()
        .then((isRemoteOnly) => {
          setRemoteMode(isRemoteOnly);
          if (!isRemoteOnly) setSidebarMode("chatList");
        })
        .catch(() => setRemoteMode(true));
    }
  }, [goTo, remoteMode]);

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

  useEffect(() => {
    activeProfileRef.current = activeProfile;
  }, [activeProfile]);

  const refreshRuntimeDiagnostic = useCallback(() => {
    const requestedProfile = activeProfile;
    window.hermesAPI
      .getRuntimeDiagnostic(requestedProfile)
      .then((diagnostic) => {
        if (activeProfileRef.current === requestedProfile)
          setRuntimeDiagnostic(diagnostic);
      })
      .catch(() => {
        if (activeProfileRef.current === requestedProfile)
          setRuntimeDiagnostic(null);
      });
  }, [activeProfile]);

  // Re-check remote mode/runtime diagnostics on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
    refreshRuntimeDiagnostic();
  }, [view, refreshRuntimeDiagnostic]);

  // Poll fast while the runtime is stale or not yet verified so the banner and
  // session indicators reflect idle-gated skill applies quickly; otherwise idle
  // at the normal cadence.
  const needsFastRuntimePoll =
    runtimeDiagnostic !== null &&
    (runtimeDiagnostic.stale || runtimeDiagnostic.status !== "verified");

  useEffect(() => {
    refreshRuntimeDiagnostic();
    const interval = setInterval(
      refreshRuntimeDiagnostic,
      needsFastRuntimePoll ? 1000 : 10000,
    );
    return () => clearInterval(interval);
  }, [refreshRuntimeDiagnostic, needsFastRuntimePoll]);

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

  const updateDisabled =
    updateState === "checking" || updateState === "downloading";
  const showUpdateButton = updateState !== "idle" && updateState !== "current";
  const updateButtonLabel =
    updateState === "checking"
      ? t("common.checkingForUpdates")
      : updateState === "available"
        ? t("common.updateMercuryVersion", { version: updateVersion })
        : updateState === "downloading"
          ? t("common.downloading", { percent: downloadPercent })
          : updateState === "ready"
            ? t("common.restartToUpdate")
            : updateState === "error"
              ? t("common.updateCheckFailed")
              : t("common.updateMercury");

  const handleNewChat = useCallback(() => {
    resumeRequestIdRef.current += 1;
    goTo("chat");
    setShowChatAgentPicker(true);
  }, [goTo]);

  const handleNewChatForProfile = useCallback(
    async (profile: string): Promise<void> => {
      const cleanProfile = profile.trim() || "default";
      const requestId = resumeRequestIdRef.current + 1;
      resumeRequestIdRef.current = requestId;

      if (cleanProfile !== activeProfileRef.current) {
        const switched = await window.hermesAPI.setActiveProfile(cleanProfile);
        if (resumeRequestIdRef.current !== requestId) {
          await window.hermesAPI
            .setActiveProfile(activeProfileRef.current)
            .catch(() => false);
          return;
        }
        if (!switched) throw new Error("Profile switch failed");
      }

      try {
        await window.hermesAPI.abortChat();
      } catch {
        // Ignore abort failures; starting a new blank chat should still work.
      }

      if (resumeRequestIdRef.current !== requestId) return;
      activeProfileRef.current = cleanProfile;
      setActiveProfile(cleanProfile);
      setMessages([]);
      setCurrentSessionId(null);
      setCurrentSessionTitle(null);
      setCurrentSessionProfile(null);
      setConversationVersion((value) => value + 1);
      setShowChatAgentPicker(false);
      goTo("chat");
      setSidebarMode("chatList");
    },
    [goTo],
  );

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
    resumeRequestIdRef.current += 1;
    activeProfileRef.current = name;
    setActiveProfile(name);
    setMessages([]);
    setCurrentSessionId(null);
    setCurrentSessionTitle(null);
    setCurrentSessionProfile(null);
    setConversationVersion((value) => value + 1);
    setShowChatAgentPicker(false);
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

  const openTraceRun = useCallback(
    (runId: string) => {
      const nextRunId = runId.trim();
      if (!nextRunId) return;
      setTraceLaunch({ mode: "run", target: { runId: nextRunId } });
      setTraceLaunchVersion((value) => value + 1);
      goTo("traceDetail");
    },
    [goTo],
  );

  useEffect(() => {
    function handleOpenTraceRunEvent(event: Event): void {
      const runId = (event as CustomEvent<{ runId?: string }>).detail?.runId;
      if (typeof runId === "string") openTraceRun(runId);
    }

    window.addEventListener("mercury:open-trace-run", handleOpenTraceRunEvent);
    return () => {
      window.removeEventListener(
        "mercury:open-trace-run",
        handleOpenTraceRunEvent,
      );
    };
  }, [openTraceRun]);

  const handleCreateScheduleFromConversation = useCallback(
    (draft: ChatScheduleConversationDraft) => {
      const draftProfile =
        typeof draft.metadata?.profile === "string"
          ? draft.metadata.profile
          : activeProfile;
      setScheduleInitialDraft({
        name: draft.name,
        prompt: draft.prompt,
        kind: draft.kind,
        deliver: Array.isArray(draft.deliver) ? draft.deliver : undefined,
        skills: draft.skills,
        agentProfile: draftProfile,
        context: draft.context,
        sourceSessionId: draft.sourceSessionId,
        sourceTraceId: draft.sourceTraceId,
        metadata: draft.metadata,
      });
      goTo("schedules");
    },
    [activeProfile, goTo],
  );

  const handleBackToSessions = useCallback(() => {
    goTo("sessions");
  }, [goTo]);

  const handleAgentProfileAction = useCallback(
    (nextView: "chat" | "skills" | "tools" | "soul" | "memory") => {
      if (nextView !== "chat") {
        setAgentReturnViews((prev) => new Set(prev).add(nextView));
      }
      goTo(nextView);
    },
    [goTo],
  );

  const handleBackToAgents = useCallback(() => {
    goTo("agents");
  }, [goTo]);

  const showGlobalRuntimeDiagnostic =
    runtimeDiagnostic &&
    !(view === "chat" && isIdleLocalUnverifiedRuntime(runtimeDiagnostic))
      ? runtimeDiagnostic
      : null;

  const handleChatSessionResolved = useCallback(
    (sessionId: string): void => {
      const resolvedSessionId = sessionId.trim();
      if (!resolvedSessionId) return;
      const resolvedProfile = activeProfileRef.current || "default";
      if (
        currentSessionId !== resolvedSessionId ||
        currentSessionProfile !== resolvedProfile
      ) {
        setSessionsRefreshToken((value) => value + 1);
      }
      setCurrentSessionId(resolvedSessionId);
      setCurrentSessionProfile(resolvedProfile);
    },
    [currentSessionId, currentSessionProfile],
  );

  const handleResumeSession = useCallback(
    async (sessionId: string, title?: string | null, profile?: string) => {
      const rowProfile = profile?.trim() || undefined;
      const nextProfile = rowProfile || activeProfile;
      const requestId = resumeRequestIdRef.current + 1;
      resumeRequestIdRef.current = requestId;
      const dbMessages = await window.hermesAPI.getSessionMessages(
        sessionId,
        rowProfile,
      );
      if (resumeRequestIdRef.current !== requestId) return;
      const chatMessages: ChatMessage[] = dbMessages.map((m) => ({
        id: `db-${m.id}`,
        role: m.role === "user" ? "user" : "agent",
        content: m.content,
      }));
      if (rowProfile) {
        activeProfileRef.current = rowProfile;
        setActiveProfile(rowProfile);
      }
      setMessages(chatMessages);
      setCurrentSessionId(sessionId);
      setCurrentSessionTitle(title?.trim() || null);
      setCurrentSessionProfile(nextProfile);
      setConversationVersion((value) => value + 1);
      setShowChatAgentPicker(false);
      goTo("chat");
    },
    [activeProfile, goTo],
  );

  return (
    <div className="layout">
      {sidebarMode === "chatList" ? (
        <ChatListSidebar
          activeProfile={activeProfile}
          currentSessionId={currentSessionId}
          currentSessionProfile={currentSessionProfile}
          refreshToken={sessionsRefreshToken}
          onBack={() => setSidebarMode("main")}
          onResumeSession={handleResumeSession}
          onOpenNewChatPicker={handleNewChat}
          onStartNewChat={handleNewChatForProfile}
        />
      ) : (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <MercuryLockup className="sidebar-brand-lockup" />
          </div>

          {showUpdateButton ? (
            <div className="sidebar-update-panel">
              <button
                className={`sidebar-update-btn sidebar-update-${updateState}`}
                onClick={handleUpdate}
                disabled={updateDisabled}
              >
                <span>{updateButtonLabel}</span>
              </button>
            </div>
          ) : null}

          <nav className="sidebar-nav">
            {NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => (
              <button
                key={v}
                className={`sidebar-nav-item ${view === v || (view === "traceDetail" && v === "sessions") ? "active" : ""}`}
                onClick={() => (v === "chat" ? openChatListSidebar() : goTo(v))}
              >
                <Icon size={16} />
                {t(labelKey)}
              </button>
            ))}
          </nav>
        </aside>
      )}

      <main className="content">
        <RuntimeDiagnosticNotice
          diagnostic={showGlobalRuntimeDiagnostic}
          onRuntimeDiagnosticRefresh={refreshRuntimeDiagnostic}
        />
        <div style={paneStyle("chat")}>
          {showChatAgentPicker ? (
            <ChatAgentPicker
              activeProfile={activeProfile}
              onStartNewChat={handleNewChatForProfile}
            />
          ) : (
            <Chat
              messages={messages}
              setMessages={setMessages}
              sessionId={currentSessionId}
              sessionTitle={currentSessionTitle}
              conversationVersion={conversationVersion}
              profile={activeProfile}
              runtimeDiagnostic={runtimeDiagnostic}
              onRuntimeDiagnosticRefresh={refreshRuntimeDiagnostic}
              onSessionResolved={handleChatSessionResolved}
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
              onCreateScheduleFromConversation={
                handleCreateScheduleFromConversation
              }
              onOpenTraceRun={openTraceRun}
              onViewSchedules={() => goTo("schedules")}
              onNewChat={handleNewChat}
            />
          )}
        </div>

        {visitedViews.has("sessions") && (
          <div style={paneStyle("sessions")}>
            {remoteMode ? (
              <div className="sessions-container">
                <div className="sessions-header">
                  <div className="sessions-header-top">
                    <h2 className="sessions-title">{t("sessions.title")}</h2>
                    <div className="sessions-header-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={handleOpenTraceActivity}
                      >
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
              sessionTarget={
                traceLaunch.mode === "session" ? traceLaunch.target : null
              }
              runId={
                traceLaunch.mode === "run" ? traceLaunch.target.runId : null
              }
              reloadToken={traceLaunchVersion}
              onBackToSessions={handleBackToSessions}
            />
          </div>
        )}

        {visitedViews.has("agents") && (
          <div style={paneStyle("agents")}>
            {remoteMode ? (
              <RemoteNotice feature="Agents" />
            ) : (
              <Agents
                activeProfile={activeProfile}
                onSelectProfile={handleSelectProfile}
                onProfileAction={handleAgentProfileAction}
              />
            )}
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
              <Tools
                profile={activeProfile}
                onBackToAgents={
                  agentReturnViews.has("tools") ? handleBackToAgents : undefined
                }
              />
            )}
          </div>
        )}

        {visitedViews.has("schedules") && (
          <div style={paneStyle("schedules")}>
            <Schedules
              profile={activeProfile}
              initialDraft={scheduleInitialDraft ?? undefined}
              onOpenTraceRun={openTraceRun}
              onOpenConversation={(sessionId) => {
                void handleResumeSession(sessionId);
              }}
            />
          </div>
        )}

        {visitedViews.has("gateway") && (
          <div style={paneStyle("gateway")}>
            {remoteMode ? (
              <RemoteNotice feature="Gateway" />
            ) : (
              <Gateway
                profile={activeProfile}
                runtimeDiagnostic={runtimeDiagnostic}
              />
            )}
          </div>
        )}

        {visitedViews.has("settings") && (
          <div style={paneStyle("settings")}>
            <Settings
              profile={activeProfile}
              runtimeDiagnostic={runtimeDiagnostic}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default Layout;
