import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, RefreshCw } from "lucide-react";
import type { ProfileInfo } from "../../../../shared/profiles";
import AgentAvatar from "../../components/common/AgentAvatar";
import { useI18n } from "../../components/useI18n";

interface ChatAgentPickerProps {
  activeProfile: string;
  onStartNewChat: (profile: string) => Promise<void> | void;
}

function sortProfiles(
  profiles: ProfileInfo[],
  activeProfile: string,
): ProfileInfo[] {
  const active = activeProfile.trim() || "default";
  return [...profiles].sort((a, b) => {
    if (a.name === active && b.name !== active) return -1;
    if (b.name === active && a.name !== active) return 1;
    if (a.name === "default" && b.name !== "default") return -1;
    if (b.name === "default" && a.name !== "default") return 1;
    return displayNameFor(a).localeCompare(displayNameFor(b));
  });
}

function displayNameFor(profile: ProfileInfo): string {
  return profile.displayName.trim() || profile.name;
}

function ChatAgentPicker({
  activeProfile,
  onStartNewChat,
}: ChatAgentPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [startingProfile, setStartingProfile] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfiles(): Promise<void> {
      setLoading(true);
      setLoadError(false);
      try {
        const listed = await window.hermesAPI.listProfiles();
        if (cancelled) return;
        setProfiles(listed);
      } catch {
        if (cancelled) return;
        setProfiles([]);
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
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

  async function startNewChat(profile: ProfileInfo): Promise<void> {
    const backendProfile = profile.name.trim() || "default";
    setStartingProfile(backendProfile);
    setStartError(null);
    try {
      await onStartNewChat(backendProfile);
    } catch {
      setStartError(t("chat.sidebarStartFailed"));
    } finally {
      setStartingProfile(null);
    }
  }

  return (
    <div className="chat-agent-picker">
      <div className="chat-agent-picker-header">
        <div>
          <h1>{t("chat.agentPickerTitle")}</h1>
          <p>{t("chat.agentPickerSubtitle")}</p>
        </div>
      </div>

      {loadError ? (
        <div className="chat-agent-picker-notice">
          {t("chat.sidebarProfilesUnavailable")}
        </div>
      ) : null}
      {startError ? (
        <div className="chat-agent-picker-notice">{startError}</div>
      ) : null}

      {loading ? (
        <div className="chat-agent-picker-loading">
          <RefreshCw size={18} />
          <span>{t("chat.sidebarLoading")}</span>
        </div>
      ) : (
        <div className="chat-agent-picker-grid">
          {sortedProfiles.map((profile) => {
            const name = displayNameFor(profile);
            const isActive = profile.name === (activeProfile.trim() || "default");
            const isStarting = startingProfile === profile.name;
            return (
              <button
                key={profile.name}
                className={`chat-agent-picker-card ${isActive ? "chat-agent-picker-card-active" : ""}`}
                onClick={() => void startNewChat(profile)}
                disabled={startingProfile !== null}
              >
                <div className="chat-agent-picker-card-top">
                  <AgentAvatar
                    profile={profile}
                    className="chat-agent-picker-avatar"
                    markClassName="chat-agent-picker-avatar-mark"
                    markSize={32}
                  />
                  <div className="chat-agent-picker-card-main">
                    <span className="chat-agent-picker-name">{name}</span>
                    <span className="chat-agent-picker-provider">
                      {profile.kind === "builtin"
                        ? t("agents.builtin")
                        : t("agents.custom")}
                    </span>
                  </div>
                  {isActive ? (
                    <span className="chat-agent-picker-active">
                      {t("chat.agentPickerCurrent")}
                    </span>
                  ) : null}
                </div>
                <div className="chat-agent-picker-model">
                  {profile.description || t("agents.noDescription")}
                </div>
                <div className="chat-agent-picker-meta">
                  <span>
                    {t("agents.skillsCount", { count: profile.skillCount })}
                  </span>
                  <span>
                    {t("agents.skillPacksCount", { count: profile.skillPackCount })}
                  </span>
                  <span aria-hidden="true">|</span>
                  <span>
                    {t("agents.memoriesCount", { count: profile.memoryCount })}
                  </span>
                </div>
                <div className="chat-agent-picker-action">
                  <MessageSquarePlus size={15} />
                  <span>
                    {isStarting
                      ? t("common.loading")
                      : t("chat.agentPickerStart")}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ChatAgentPicker;
