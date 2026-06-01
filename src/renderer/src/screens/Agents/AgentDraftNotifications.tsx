import { ArrowRight, Sparkles } from "lucide-react";
import type { AgentDraftChangeEvent } from "../../../../shared/agents";
import { useI18n } from "../../components/useI18n";

interface AgentDraftNotificationsProps {
  notifications: AgentDraftChangeEvent[];
}

/**
 * Compact "Mercury changed X: prev → new" diff chip surfaced just above the
 * composer. Shows the most recent change so the live draft mutations stay
 * visible without crowding the conversation.
 */
export function AgentDraftNotifications({
  notifications,
}: AgentDraftNotificationsProps): React.JSX.Element | null {
  const { t } = useI18n();
  if (notifications.length === 0) return null;

  const event = notifications[0];
  const notification = event.notification;
  const previous = notification?.previousText;
  const next = notification?.nextText;
  const hasDiff = previous !== undefined || next !== undefined;

  return (
    <div className="agents-diff-chip" aria-live="polite">
      <span className="agents-diff-chip-dot">
        <Sparkles size={16} />
      </span>
      <div className="agents-diff-chip-lines">
        <div className="agents-diff-chip-title">
          {notification?.text || t("agents.creatorDraftChanged")}
        </div>
        {hasDiff ? (
          <div className="agents-diff-chip-diff">
            <span className="agents-diff-chip-prev">
              {previous || t("agents.creatorEmptyValue")}
            </span>
            <span className="agents-diff-chip-arrow" aria-hidden="true">
              <ArrowRight size={14} />
            </span>
            <span className="agents-diff-chip-next">
              {next || t("agents.creatorEmptyValue")}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
