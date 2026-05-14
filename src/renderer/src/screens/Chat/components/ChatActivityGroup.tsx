import type React from "react";
import {
  activityStatusForGroup,
  formatActivityMetadata,
  summarizeActivityEvents,
} from "../chatActivity";
import type { ChatActivityGroup as ChatActivityGroupModel } from "../types";

interface ChatActivityGroupProps {
  group: ChatActivityGroupModel;
  onToggle: (groupId: string) => void;
}

export function ChatActivityGroup({
  group,
  onToggle,
}: ChatActivityGroupProps): React.JSX.Element | null {
  const summaries = summarizeActivityEvents(group.events);
  if (summaries.length === 0) return null;

  const status = activityStatusForGroup(group.events, group.status);
  const detailsId = `chat-activity-details-${group.id}`;

  return (
    <section className={`chat-activity-group chat-activity-group-${status}`}>
      <button
        type="button"
        className="chat-activity-summary"
        aria-expanded={group.expanded}
        aria-controls={detailsId}
        onClick={() => onToggle(group.id)}
      >
        <span className={`chat-activity-dot chat-activity-dot-${status}`} />
        <span className="chat-activity-summary-label">Activity</span>
        <span className="chat-activity-pills">
          {summaries.map((summary) => (
            <span
              key={summary.key}
              className={`chat-activity-pill chat-activity-pill-${summary.status}`}
            >
              {summary.label}
              {summary.count > 1 ? <span className="chat-activity-count">×{summary.count}</span> : null}
            </span>
          ))}
        </span>
        <span className="chat-activity-toggle">{group.expanded ? "Hide" : "Details"}</span>
      </button>

      {group.expanded ? (
        <div id={detailsId} className="chat-activity-details">
          {group.events.map((event) => {
            const metadata = formatActivityMetadata(event.metadata);
            return (
              <article key={event.id} className="chat-activity-event">
                <div className="chat-activity-event-head">
                  <span className="chat-activity-event-type">{event.type}</span>
                  <time>{formatTime(event.timestamp)}</time>
                </div>
                <div className="chat-activity-event-title">{event.title}</div>
                {event.detail ? <div className="chat-activity-event-detail">{event.detail}</div> : null}
                {metadata.length > 0 ? (
                  <ul className="chat-activity-metadata">
                    {metadata.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
