import { useEffect, useState, useRef, memo } from "react";
import { Activity, Plus, Search, X, ChatBubble } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { useCachedSessions } from "./useCachedSessions";
import { useSessionRuntimeActivity } from "./useSessionRuntimeActivity";
import {
  formatSessionFullDate,
  formatSessionModel,
  formatSessionProfile,
  formatSessionTime,
  groupSessionsByDate,
  isActiveSession,
  sessionRowKey,
  type CachedSession,
  type SearchResult,
} from "./sessionListUtils";

interface SessionsProps {
  onResumeSession: (sessionId: string, title?: string | null, profile?: string) => void;
  onOpenSessionTrace: (sessionId: string, title?: string | null, profile?: string) => void;
  onOpenTraceActivity?: () => void;
  onNewChat: () => void;
  currentSessionId: string | null;
  currentSessionProfile?: string | null;
  refreshToken?: number;
}

function highlightSnippet(snippet: string): React.JSX.Element {
  const parts = snippet.split(/(<<.*?>>)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("<<") && part.endsWith(">>")) {
          return <mark key={i}>{part.slice(2, -2)}</mark>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// Memoized session card
const SessionCard = memo(function SessionCard({
  session,
  isActive,
  isRunActive,
  runActiveLabel,
  showFullDate,
  onClick,
  onOpenTrace,
  traceLabel,
  traceAriaLabel,
}: {
  session: CachedSession;
  isActive: boolean;
  isRunActive: boolean;
  runActiveLabel: string;
  showFullDate: boolean;
  onClick: () => void;
  onOpenTrace: () => void;
  traceLabel: string;
  traceAriaLabel: string;
}) {
  return (
    <div className={`sessions-card ${isActive ? "sessions-card--active" : ""}`}>
      <button className="sessions-card-primary" onClick={onClick}>
        <div className="sessions-card-main">
          <span className="sessions-card-title">
            {isRunActive ? (
              <span
                className="session-activity-dot"
                title={runActiveLabel}
                aria-label={runActiveLabel}
              />
            ) : null}
            {session.title || "New conversation"}
          </span>
          <span className="sessions-card-time">
            {showFullDate
              ? formatSessionFullDate(session.startedAt)
              : formatSessionTime(session.startedAt)}
          </span>
        </div>
        <div className="sessions-card-tags">
          <span className="sessions-tag sessions-tag--source">
            {formatSessionProfile(session.profile)}
          </span>
          <span className="sessions-tag">
            {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
          </span>
          {session.model && (
            <span className="sessions-tag sessions-tag--model">
              {formatSessionModel(session.model)}
            </span>
          )}
        </div>
      </button>
      <button
        className="sessions-card-trace"
        onClick={(event) => {
          event.stopPropagation();
          onOpenTrace();
        }}
        aria-label={traceAriaLabel}
        title={traceLabel}
      >
        <Activity size={13} />
        <span>{traceLabel}</span>
      </button>
    </div>
  );
});

function Sessions({
  onResumeSession,
  onOpenSessionTrace,
  onOpenTraceActivity,
  onNewChat,
  currentSessionId,
  currentSessionProfile,
  refreshToken,
}: SessionsProps): React.JSX.Element {
  const { t } = useI18n();
  const { sessions, loading, error, reload } = useCachedSessions({
    limit: 50,
    refreshToken,
  });
  const { activeBySessionKey } = useSessionRuntimeActivity();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      const results = await window.hermesAPI.searchSessions(searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery, refreshToken]);

  const isShowingSearch = searchQuery.trim().length > 0;
  const grouped = groupSessionsByDate(sessions);

  return (
    <div className="sessions-container">
      {/* Header with integrated search */}
      <div className="sessions-header">
        <div className="sessions-header-top">
          <h2 className="sessions-title">{t("sessions.title")}</h2>
          <div className="sessions-header-actions">
            {onOpenTraceActivity ? (
              <button className="btn btn-secondary" onClick={onOpenTraceActivity}>
                <Activity size={14} />
                {t("sessions.traceActivity")}
              </button>
            ) : null}
            <button className="btn btn-primary " onClick={onNewChat}>
              <Plus size={14} />
              {t("sessions.newChat")}
            </button>
          </div>
        </div>
        <div className="sessions-searchbar">
          <Search size={14} className="sessions-searchbar-icon" />
          <input
            ref={searchRef}
            className="sessions-searchbar-input"
            type="text"
            placeholder={t("sessions.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="btn-ghost sessions-searchbar-clear"
              onClick={() => {
                setSearchQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="sessions-loading">
          <div className="loading-spinner" />
        </div>
      ) : isShowingSearch ? (
        isSearching ? (
          <div className="sessions-loading">
            <div className="loading-spinner" />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="sessions-empty">
            <Search size={32} className="sessions-empty-icon" />
            <p className="sessions-empty-text">{t("sessions.noResults")}</p>
            <p className="sessions-empty-hint">{t("sessions.noResultsHint")}</p>
          </div>
        ) : (
          <div className="sessions-list">
            {searchResults.map((r) => {
              const title = r.title || `${t("sessions.title")} ${r.sessionId.slice(-6)}`;
              const traceLabel = t("sessions.viewTraces");
              return (
                <div
                  key={sessionRowKey(r.sessionId, r.profile)}
                  className={`sessions-card ${isActiveSession(currentSessionId, currentSessionProfile, r.sessionId, r.profile) ? "sessions-card--active" : ""}`}
                >
                  <button
                    className="sessions-card-primary"
                    onClick={() => onResumeSession(r.sessionId, r.title, r.profile)}
                  >
                    <div className="sessions-card-main">
                      <span className="sessions-card-title">
                        {activeBySessionKey.has(
                          sessionRowKey(r.sessionId, r.profile),
                        ) ? (
                          <span
                            className="session-activity-dot"
                            title={t("sessions.runActive")}
                            aria-label={t("sessions.runActive")}
                          />
                        ) : null}
                        {title}
                      </span>
                      <span className="sessions-card-time">
                        {formatSessionFullDate(r.startedAt)}
                      </span>
                    </div>
                    {r.snippet && (
                      <div className="sessions-result-snippet">
                        {highlightSnippet(r.snippet)}
                      </div>
                    )}
                    <div className="sessions-card-tags">
                      <span className="sessions-tag sessions-tag--source">
                        {formatSessionProfile(r.profile)}
                      </span>
                      <span className="sessions-tag">
                        {r.messageCount} {r.messageCount !== 1 ? t("sessions.messages") : t("sessions.messageSingular")}
                      </span>
                      {r.model && (
                        <span className="sessions-tag sessions-tag--model">
                          {formatSessionModel(r.model)}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    className="sessions-card-trace"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSessionTrace(r.sessionId, r.title, r.profile);
                    }}
                    aria-label={t("sessions.viewTracesAria", { title })}
                    title={traceLabel}
                  >
                    <Activity size={13} />
                    <span>{traceLabel}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )
      ) : error && sessions.length === 0 ? (
        <div className="sessions-empty">
          <ChatBubble size={32} className="sessions-empty-icon" />
          <p className="sessions-empty-text">{t("sessions.loadError")}</p>
          <p className="sessions-empty-hint">{error}</p>
          <button className="btn btn-secondary" onClick={() => void reload()}>
            {t("common.retry")}
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="sessions-empty">
          <ChatBubble size={32} className="sessions-empty-icon" />
          <p className="sessions-empty-text">{t("sessions.empty")}</p>
          <p className="sessions-empty-hint">{t("sessions.emptyHint")}</p>
        </div>
      ) : (
        <div className="sessions-list">
          {grouped.map((group) => (
            <div key={group.label} className="sessions-group">
              <div className="sessions-group-label">{t(`sessions.${group.label}`)}</div>
              {group.sessions.map((s) => (
                <SessionCard
                  key={sessionRowKey(s.id, s.profile)}
                  session={s}
                  isActive={isActiveSession(currentSessionId, currentSessionProfile, s.id, s.profile)}
                  isRunActive={activeBySessionKey.has(
                    sessionRowKey(s.id, s.profile),
                  )}
                  runActiveLabel={t("sessions.runActive")}
                  showFullDate={
                    group.label === "thisWeek" || group.label === "earlier"
                  }
                  onClick={() => onResumeSession(s.id, s.title, s.profile)}
                  onOpenTrace={() => onOpenSessionTrace(s.id, s.title, s.profile)}
                  traceLabel={t("sessions.viewTraces")}
                  traceAriaLabel={t("sessions.viewTracesAria", {
                    title: s.title || "New conversation",
                  })}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Sessions;
