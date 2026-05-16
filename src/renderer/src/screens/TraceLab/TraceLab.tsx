import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessagesSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import type { SkillTrainingRun, TraceRun } from "../../../../shared/traces";
import { useI18n } from "../../components/useI18n";

import {
  EmptyState,
  EventInspector,
  Fact,
  Metric,
  SkillTraceSummary,
  TraceEventRow,
} from "./components/TraceLabComponents";
import {
  RUN_FILTERS,
  type RunFilter,
  type SelectedEventRef,
  type TraceConversation,
  type TraceSessionTarget,
} from "./trace-lab.types";
import {
  buildConversationTimeline,
  buildTraceConversations,
  filterTraceConversationsForSessionTarget,
  formatTime,
  traceConversationMatchesFilter,
  traceConversationMatchesSearch,
} from "./trace-lab.helpers";

interface TraceLabProps {
  mode?: "all" | "session";
  sessionTarget?: TraceSessionTarget | null;
  reloadToken?: number;
  onBackToSessions?: () => void;
}

function shortSessionId(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function TraceLab({
  mode = "all",
  sessionTarget = null,
  reloadToken = 0,
  onBackToSessions,
}: TraceLabProps): React.JSX.Element {
  const { t } = useI18n();
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [selectedConversationKey, setSelectedConversationKey] = useState<string | null>(null);
  const [selectedEventRef, setSelectedEventRef] = useState<SelectedEventRef | null>(null);
  const [expandedConversationKeys, setExpandedConversationKeys] = useState<Set<string>>(() => new Set());
  const [skillRuns, setSkillRuns] = useState<SkillTrainingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runQuery, setRunQuery] = useState("");
  const [runFilter, setRunFilter] = useState<RunFilter>("all");

  async function load(): Promise<void> {
    setLoading(true);
    const [nextRuns, nextSkillRuns] = await Promise.all([
      window.hermesAPI.listTraceRuns(),
      window.hermesAPI.listSkillTrainingRuns(),
    ]);
    setRuns(nextRuns);
    setSkillRuns(nextSkillRuns);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reloadToken]);

  const conversations = useMemo(() => buildTraceConversations(runs), [runs]);
  const isSessionMode = mode === "session" && Boolean(sessionTarget);

  const sessionConversations = useMemo(() => {
    if (!isSessionMode || !sessionTarget) return [];
    return filterTraceConversationsForSessionTarget(conversations, sessionTarget);
  }, [conversations, isSessionMode, sessionTarget]);

  const filteredConversations = useMemo(() => {
    if (isSessionMode) return sessionConversations;
    return conversations.filter(
      (conversation) =>
        traceConversationMatchesFilter(conversation, runFilter) &&
        traceConversationMatchesSearch(conversation, runQuery),
    );
  }, [conversations, isSessionMode, runFilter, runQuery, sessionConversations]);

  const metricConversations = isSessionMode ? sessionConversations : conversations;

  const selectedConversation = useMemo(() => {
    const selected = filteredConversations.find(
      (conversation) => conversation.key === selectedConversationKey,
    );
    if (selected) return selected;
    if (filteredConversations[0]) return filteredConversations[0];
    if (!isSessionMode && !runQuery.trim() && runFilter === "all") return conversations[0] || null;
    return null;
  }, [conversations, filteredConversations, isSessionMode, runFilter, runQuery, selectedConversationKey]);

  const timeline = useMemo(
    () => (selectedConversation ? buildConversationTimeline(selectedConversation) : []),
    [selectedConversation],
  );

  const selectedTimelineItem = useMemo(() => {
    if (timeline.length === 0) return null;
    return (
      timeline.find(
        (item) =>
          item.run.id === selectedEventRef?.runId &&
          item.event.id === selectedEventRef.eventId,
      ) || timeline[0]
    );
  }, [selectedEventRef, timeline]);

  const selectedConversationSkillRuns = useMemo(() => {
    if (!selectedConversation) return [];
    const selectedRunIds = new Set(selectedConversation.runs.map((run) => run.id));
    return skillRuns.filter(
      (skillRun) => skillRun.linkedRunId && selectedRunIds.has(skillRun.linkedRunId),
    );
  }, [selectedConversation, skillRuns]);

  const metricSkillRunCount = useMemo(() => {
    if (!isSessionMode) return skillRuns.length;
    const scopedRunIds = new Set(
      metricConversations.flatMap((conversation) => conversation.runs.map((run) => run.id)),
    );
    return skillRuns.filter(
      (skillRun) => skillRun.linkedRunId && scopedRunIds.has(skillRun.linkedRunId),
    ).length;
  }, [isSessionMode, metricConversations, skillRuns]);

  useEffect(() => {
    if (!isSessionMode) return;
    const nextConversation = sessionConversations[0] || null;
    setSelectedConversationKey(nextConversation?.key ?? null);
    const firstTimelineItem = nextConversation
      ? buildConversationTimeline(nextConversation)[0]
      : null;
    setSelectedEventRef(
      firstTimelineItem
        ? { runId: firstTimelineItem.run.id, eventId: firstTimelineItem.event.id }
        : null,
    );
    if (nextConversation?.runCount && nextConversation.runCount > 1) {
      setExpandedConversationKeys((current) => new Set(current).add(nextConversation.key));
    }
  }, [isSessionMode, sessionConversations]);

  const headerTitle = isSessionMode
    ? sessionTarget?.title?.trim() || selectedConversation?.title ||
      (sessionTarget ? `Session ${shortSessionId(sessionTarget.sessionId)}` : "Session Trace")
    : "Trace Lab";

  function selectConversation(conversation: TraceConversation): void {
    setSelectedConversationKey(conversation.key);
    const firstRun = conversation.runs[0];
    setSelectedEventRef(firstRun?.events[0] ? { runId: firstRun.id, eventId: firstRun.events[0].id } : null);
    if (conversation.runCount > 1) {
      setExpandedConversationKeys((current) => new Set(current).add(conversation.key));
    }
  }

  function selectRunInConversation(conversation: TraceConversation, run: TraceRun): void {
    setSelectedConversationKey(conversation.key);
    setSelectedEventRef(run.events[0] ? { runId: run.id, eventId: run.events[0].id } : null);
  }

  function toggleConversation(conversationKey: string): void {
    setExpandedConversationKeys((current) => {
      const next = new Set(current);
      if (next.has(conversationKey)) next.delete(conversationKey);
      else next.add(conversationKey);
      return next;
    });
  }

  function selectSkillRun(skillRun: SkillTrainingRun): void {
    const linkedRun = runs.find((run) => run.id === skillRun.linkedRunId);
    if (!linkedRun) return;
    const linkedConversation = conversations.find((conversation) =>
      conversation.runs.some((run) => run.id === linkedRun.id),
    );
    if (!linkedConversation) return;
    setSelectedConversationKey(linkedConversation.key);
    setSelectedEventRef({ runId: linkedRun.id, eventId: skillRun.id });
    setExpandedConversationKeys((current) => new Set(current).add(linkedConversation.key));
    if (
      runFilter !== "all" &&
      !traceConversationMatchesFilter(linkedConversation, runFilter)
    ) {
      setRunFilter("all");
    }
    setRunQuery("");
  }

  return (
    <div className={`trace-lab ${isSessionMode ? "trace-lab--session" : ""}`}>
      <header className="trace-lab-header">
        <div>
          <p className="trace-eyebrow">
            {isSessionMode ? "Session Trace" : "Agent Intelligence"}
          </p>
          <h2>{headerTitle}</h2>
          <p className="trace-lab-subtitle">
            {isSessionMode
              ? "Review the timeline, details, and inspector for this session without a duplicate conversation list."
              : "Review full conversations first, then expand the runs and structured events that explain how Hermes answered."}
          </p>
        </div>
        <div className="trace-header-actions">
          {onBackToSessions ? (
            <button className="btn btn-secondary" onClick={onBackToSessions}>
              <ArrowLeft size={15} />
              {t("sessions.backToSessions")}
            </button>
          ) : null}
          <span className="trace-mode-badge">
            <MessagesSquare size={14} />
            {isSessionMode ? "Session" : "Conversations"}
          </span>
          <span className="trace-mode-badge">
            <BookOpenCheck size={14} />
            Skill evaluation
          </span>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </header>

      <section className="trace-metrics" aria-label="Trace metrics">
        <Metric icon={Activity} label="Conversations" value={metricConversations.length} />
        <Metric
          icon={CheckCircle2}
          label="Completed"
          value={metricConversations.filter((conversation) => conversation.status === "completed").length}
        />
        <Metric
          icon={AlertCircle}
          label="Needs attention"
          value={metricConversations.filter((conversation) => conversation.hasNeedsAttention).length}
        />
        <Metric icon={BrainCircuit} label="Skill reviews" value={metricSkillRunCount} />
      </section>

      <section className={`trace-workbench ${isSessionMode ? "trace-workbench--session" : ""}`}>
        {!isSessionMode ? (
        <aside className="trace-run-list" aria-label="Trace conversations">
          <div className="trace-panel-heading">
            <div>
              <p className="trace-eyebrow">Conversations</p>
              <h3>Recent activity</h3>
            </div>
            <span className="trace-run-count">
              {filteredConversations.length}/{conversations.length}
            </span>
          </div>

          <label className="trace-run-search">
            <Search size={14} />
            <input
              value={runQuery}
              onChange={(event) => setRunQuery(event.target.value)}
              placeholder="Search conversations, runs, events"
              aria-label="Search trace conversations"
            />
          </label>

          <div className="trace-run-filters" aria-label="Trace conversation filters">
            {RUN_FILTERS.map((filter) => (
              <button
                key={filter.key}
                className={runFilter === filter.key ? "active" : ""}
                onClick={() => setRunFilter(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="trace-run-results">
            {conversations.length === 0 ? (
              <EmptyState title="No trace conversations yet" />
            ) : filteredConversations.length === 0 ? (
              <EmptyState
                title="No matching conversations"
                body="Try a different search phrase, session id, event type, status, or filter."
              />
            ) : (
              filteredConversations.map((conversation) => {
                const expanded = expandedConversationKeys.has(conversation.key);
                const selected = selectedConversation?.key === conversation.key;
                const selectedRunId = selectedTimelineItem?.run.id;
                return (
                  <section
                    key={conversation.key}
                    className={`trace-conversation-item ${selected ? "active" : ""}`}
                  >
                    <button
                      className="trace-conversation-row"
                      title={conversation.latestMessagePreview || conversation.messagePreview}
                      onClick={() => selectConversation(conversation)}
                    >
                      <span className={`trace-status-dot ${conversation.status}`} />
                      <strong>{conversation.title}</strong>
                      <span>{conversation.profileLabel}</span>
                      {conversation.latestMessagePreview ? (
                        <small className="trace-run-preview">
                          {conversation.latestMessagePreview}
                        </small>
                      ) : null}
                      <small className="trace-conversation-meta">
                        {formatTime(conversation.updatedAt)} · {conversation.runCount} {conversation.runCount === 1 ? "run" : "runs"}
                        {conversation.sessionId ? ` · session ${conversation.sessionId.slice(0, 8)}` : ""}
                      </small>
                    </button>
                    {conversation.runCount > 1 ? (
                      <button
                        className="trace-conversation-toggle"
                        onClick={() => toggleConversation(conversation.key)}
                        aria-expanded={expanded}
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {expanded ? "Hide runs" : "Show runs"}
                      </button>
                    ) : null}
                    {expanded ? (
                      <div className="trace-run-children">
                        {conversation.runs.map((run, index) => (
                          <button
                            key={run.id}
                            className={`trace-run-child-row ${selectedRunId === run.id ? "active" : ""}`}
                            onClick={() => selectRunInConversation(conversation, run)}
                          >
                            <span className={`trace-status-dot ${run.status}`} />
                            <strong>Run {index + 1}</strong>
                            <span>{run.title}</span>
                            <small>
                              {formatTime(run.updatedAt)} · {run.usage?.totalTokens || 0} tokens
                            </small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
        </aside>
        ) : null}

        <article className="trace-detail" aria-label="Selected trace conversation">
          {selectedConversation ? (
            <>
              <div className="trace-detail-title">
                <div>
                  <p className="trace-eyebrow">{selectedConversation.profileLabel}</p>
                  <h3 title={selectedConversation.latestMessagePreview || selectedConversation.messagePreview}>
                    {selectedConversation.title}
                  </h3>
                </div>
                <span className={`trace-status-pill ${selectedConversation.status}`}>
                  {selectedConversation.status}
                </span>
              </div>

              <div className="trace-timeline">
                <div className="trace-section-title">
                  <div>
                    <p className="trace-eyebrow">Event Timeline</p>
                    <h3>Merged conversation evidence</h3>
                  </div>
                  <span>{selectedConversation.eventCount} events</span>
                </div>
                {timeline.length === 0 ? (
                  <EmptyState title="No events recorded" />
                ) : (
                  timeline.map((item) => (
                    <TraceEventRow
                      key={item.key}
                      event={item.event}
                      contextLabel={item.contextLabel}
                      selected={item.key === selectedTimelineItem?.key}
                      onSelect={() =>
                        setSelectedEventRef({ runId: item.run.id, eventId: item.event.id })
                      }
                    />
                  ))
                )}
              </div>

              <div className="trace-facts">
                <Fact label="Started" value={formatTime(selectedConversation.startedAt)} />
                <Fact label="Updated" value={formatTime(selectedConversation.updatedAt)} />
                <Fact label="Agent runs" value={String(selectedConversation.runCount)} />
                <Fact label="Tokens" value={String(selectedConversation.usage.totalTokens || 0)} />
                <Fact
                  label="Cost"
                  value={
                    selectedConversation.usage.cost != null
                      ? `$${selectedConversation.usage.cost.toFixed(4)}`
                      : "n/a"
                  }
                />
              </div>

              <section className="trace-request-preview">
                <p className="trace-eyebrow">Conversation messages</p>
                <div className="trace-message-stack">
                  {selectedConversation.runs.map((run, index) => (
                    <button
                      key={run.id}
                      className="trace-message-summary"
                      onClick={() => selectRunInConversation(selectedConversation, run)}
                    >
                      <strong>Run {index + 1}: {run.title}</strong>
                      <span>{run.messagePreview || "No message preview recorded."}</span>
                    </button>
                  ))}
                </div>
              </section>

              <SkillTraceSummary
                skillRuns={selectedConversationSkillRuns}
                onSelect={selectSkillRun}
              />
            </>
          ) : (
            <EmptyState
              title={isSessionMode ? t("sessions.noSessionTraces") : "No conversation selected"}
              body={isSessionMode ? t("sessions.noSessionTracesHint") : undefined}
            />
          )}
        </article>

        <aside className="trace-inspector" aria-label="Trace inspector">
          <div className="trace-panel-heading">
            <div>
              <p className="trace-eyebrow">Inspector</p>
              <h3>
                {selectedTimelineItem ? selectedTimelineItem.event.title : "No event selected"}
              </h3>
            </div>
          </div>

          {selectedTimelineItem ? (
            <EventInspector
              run={selectedTimelineItem.run}
              event={selectedTimelineItem.event}
            />
          ) : (
            <EmptyState title="No event selected" />
          )}
        </aside>
      </section>
    </div>
  );
}

export default TraceLab;
