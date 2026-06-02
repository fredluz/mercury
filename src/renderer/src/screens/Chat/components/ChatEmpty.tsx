import type React from "react";
import { Bell, ChartLine, Clock, Code, Mail, Search } from "lucide-react";
import MercuryMark from "../../../components/common/MercuryMark";
import AgentAvatar from "../../../components/common/AgentAvatar";
import type { ProfileInfo } from "../../../../../shared/profiles";

interface ChatEmptyProps {
  setPrompt: (value: string) => void;
  focusInput: () => void;
  t: (key: string) => string;
  agentProfile?: ProfileInfo | null;
}

export function ChatEmpty({
  setPrompt,
  focusInput,
  t,
  agentProfile,
}: ChatEmptyProps): React.JSX.Element {
  const suggestions = [
    { icon: Search, text: "Search the web for today's top tech news", label: "chat.suggestionSearch" },
    { icon: Bell, text: "Set a reminder to check emails every day at 9 AM", label: "chat.suggestionReminder" },
    { icon: Mail, text: "Read my latest emails and summarize them", label: "chat.suggestionEmail" },
    { icon: Code, text: "Write a Python script to rename all files in a folder", label: "chat.suggestionScript" },
    { icon: Clock, text: "Schedule a cron job to back up my database every night", label: "chat.suggestionSchedule" },
    { icon: ChartLine, text: "Analyze this CSV file and show key insights", label: "chat.suggestionAnalyze" },
  ];
  return (
    <div className="chat-empty">
      <div className="chat-empty-icon">
        {agentProfile ? (
          <AgentAvatar
            profile={agentProfile}
            className="chat-empty-avatar"
            markClassName="chat-empty-avatar-mark"
            markSize={64}
          />
        ) : (
          <MercuryMark size={64} decorative />
        )}
      </div>
      <div className="chat-empty-text">{t("chat.emptyTitle")}</div>
      <div className="chat-empty-hint">{t("chat.emptyHint")}</div>
      <div className="chat-empty-suggestions">
        {suggestions.map(({ icon: Icon, text, label }) => (
          <button
            key={label}
            className="chat-suggestion"
            onClick={() => {
              setPrompt(text);
              focusInput();
            }}
          >
            <Icon size={16} />
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
