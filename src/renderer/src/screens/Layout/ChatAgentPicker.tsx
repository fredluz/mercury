import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, RefreshCw } from "lucide-react";
import MercuryMark from "../../components/common/MercuryMark";
import { useI18n } from "../../components/useI18n";
import { formatSessionModel } from "../Sessions/sessionListUtils";

type ProfileSummary = Awaited<
  ReturnType<Window["hermesAPI"]["listProfiles"]>
>[number];

interface ChatAgentPickerProps {
  activeProfile: string;
  onStartNewChat: (profile: string) => Promise<void> | void;
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

function providerLabel(provider: string, t: (key: string) => string): string {
  if (!provider || provider === "auto") return t("chat.agentPickerAuto");
  if (provider === "custom") return t("chat.agentPickerLocal");
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function AgentAvatar({ name }: { name: string }): React.JSX.Element {
  if (name === "default") {
    return (
      <div className="chat-agent-picker-avatar chat-agent-picker-avatar-mark">
        <MercuryMark size={32} decorative />
      </div>
    );
  }

  return (
    <div className="chat-agent-picker-avatar">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function ChatAgentPicker({
  activeProfile,
  onStartNewChat,
}: ChatAgentPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([
    fallbackProfile(activeProfile),
  ]);
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
        setProfiles(
          listed.length > 0 ? listed : [fallbackProfile(activeProfile)],
        );
      } catch {
        if (cancelled) return;
        setProfiles([fallbackProfile(activeProfile)]);
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

  async function startNewChat(profile: string): Promise<void> {
    const cleanProfile = profile.trim() || "default";
    setStartingProfile(cleanProfile);
    setStartError(null);
    try {
      await onStartNewChat(cleanProfile);
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
            const name = profile.name.trim() || "default";
            const isActive = name === (activeProfile.trim() || "default");
            const isStarting = startingProfile === name;
            return (
              <button
                key={name}
                className={`chat-agent-picker-card ${isActive ? "chat-agent-picker-card-active" : ""}`}
                onClick={() => void startNewChat(name)}
                disabled={startingProfile !== null}
              >
                <div className="chat-agent-picker-card-top">
                  <AgentAvatar name={name} />
                  <div className="chat-agent-picker-card-main">
                    <span className="chat-agent-picker-name">{name}</span>
                    <span className="chat-agent-picker-provider">
                      {providerLabel(profile.provider, t)}
                    </span>
                  </div>
                  {isActive ? (
                    <span className="chat-agent-picker-active">
                      {t("chat.agentPickerCurrent")}
                    </span>
                  ) : null}
                </div>
                <div className="chat-agent-picker-model">
                  {profile.model
                    ? formatSessionModel(profile.model)
                    : t("chat.noModel")}
                </div>
                <div className="chat-agent-picker-meta">
                  <span>
                    {t("chat.agentPickerSkills", { count: profile.skillCount })}
                  </span>
                  <span>
                    {profile.gatewayRunning
                      ? t("chat.agentPickerGatewayOn")
                      : t("chat.agentPickerGatewayOff")}
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
