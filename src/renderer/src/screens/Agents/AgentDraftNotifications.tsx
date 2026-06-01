import type { AgentDraftChangeEvent } from "../../../../shared/agents";
import { useI18n } from "../../components/useI18n";

interface AgentDraftNotificationsProps {
  notifications: AgentDraftChangeEvent[];
}

export function AgentDraftNotifications({
  notifications,
}: AgentDraftNotificationsProps): React.JSX.Element | null {
  const { t } = useI18n();
  if (notifications.length === 0) return null;

  return (
    <div className="agents-draft-notifications" aria-live="polite">
      <h4>{t("agents.creatorNotifications")}</h4>
      <div className="agents-draft-notification-list">
        {notifications.map((event, index) => {
          const notification = event.notification;
          const change = event.changes[0];
          const previous = notification?.previousText;
          const next = notification?.nextText;
          return (
            <div
              key={`${event.draftId}:${event.revision}:${change?.path ?? "change"}:${index}`}
              className="agents-draft-notification"
            >
              <div className="agents-draft-notification-title">
                {notification?.text || t("agents.creatorDraftChanged")}
              </div>
              {previous !== undefined || next !== undefined ? (
                <div className="agents-draft-notification-diff">
                  <span>
                    {t("agents.creatorPrevious")}: {previous || t("agents.creatorEmptyValue")}
                  </span>
                  <span aria-hidden="true">→</span>
                  <span>
                    {t("agents.creatorNew")}: {next || t("agents.creatorEmptyValue")}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
