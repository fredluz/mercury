import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  FileCode2,
  FileSearch,
  Gauge,
  HelpCircle,
  MessageSquareText,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type {
  SkillTrainingRun,
  TraceEvent,
  TraceRun,
} from "../../../../shared/traces";

const EVENT_LABELS: Record<string, string> = {
  "run.started": "Run started",
  "message.user": "User",
  "message.agent.delta": "Agent",
  "tool.progress": "Tool",
  "usage.recorded": "Usage",
  "run.completed": "Completed",
  "run.failed": "Failed",
  "run.aborted": "Aborted",
  "skill.used": "Skill used",
  "skill.eval": "Skill eval",
  "skill.promoted": "Promoted",
  "skill.rejected": "Rejected",
};

const EVENT_ICONS: Record<string, typeof Activity> = {
  "run.started": Activity,
  "message.user": FileSearch,
  "message.agent.delta": Sparkles,
  "tool.progress": Wrench,
  "usage.recorded": Gauge,
  "run.completed": CheckCircle2,
  "run.failed": AlertCircle,
  "run.aborted": AlertCircle,
  "skill.used": BrainCircuit,
  "skill.eval": Database,
  "skill.promoted": ShieldCheck,
  "skill.rejected": AlertCircle,
};

type RunMapStep = {
  key: string;
  label: string;
  caption: string;
  event?: TraceEvent;
  icon: typeof Activity;
  tone: "blue" | "green" | "amber" | "red" | "neutral";
};

type Narrative = {
  happened: string;
  matters: string;
};

function TraceLab(): React.JSX.Element {
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [skillRuns, setSkillRuns] = useState<SkillTrainingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runQuery, setRunQuery] = useState("");

  async function load(): Promise<void> {
    setLoading(true);
    const [nextRuns, nextSkillRuns] = await Promise.all([
      window.hermesAPI.listTraceRuns(),
      window.hermesAPI.listSkillTrainingRuns(),
    ]);
    setRuns(nextRuns);
    setSkillRuns(nextSkillRuns);
    setSelectedRunId((current) => current || nextRuns[0]?.id || null);
    setSelectedEventId(
      (current) => current || nextRuns[0]?.events[0]?.id || null,
    );
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredRuns = useMemo(() => {
    const query = runQuery.trim().toLowerCase();
    if (!query) return runs;
    return runs.filter((run) => traceRunMatchesSearch(run, query));
  }, [runQuery, runs]);

  const selectedRun = useMemo(() => {
    const selected = runs.find((run) => run.id === selectedRunId) || null;
    if (!runQuery.trim()) return selected || runs[0] || null;
    if (selected && filteredRuns.some((run) => run.id === selected.id)) {
      return selected;
    }
    return filteredRuns[0] || null;
  }, [filteredRuns, runQuery, runs, selectedRunId]);

  const selectedEvent = useMemo(() => {
    if (!selectedRun) return null;
    return (
      selectedRun.events.find((event) => event.id === selectedEventId) ||
      selectedRun.events[0] ||
      null
    );
  }, [selectedEventId, selectedRun]);

  function selectRun(run: TraceRun): void {
    setSelectedRunId(run.id);
    setSelectedEventId(run.events[0]?.id || null);
  }

  return (
    <div className="trace-lab">
      <header className="trace-lab-header">
        <div>
          <p className="trace-eyebrow">Agent Intelligence</p>
          <h2>Trace Lab</h2>
          <p className="trace-lab-subtitle">
            Follow the agent from request to answer, then inspect what it
            learned for the next run.
          </p>
        </div>
        <div className="trace-header-actions">
          <span className="trace-mode-badge">
            <Route size={14} />
            Run map
          </span>
          <span className="trace-mode-badge">
            <BookOpenCheck size={14} />
            Skill evaluation
          </span>
          <button
            className="btn btn-secondary"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </header>

      <section className="trace-metrics" aria-label="Trace metrics">
        <Metric icon={Activity} label="Recorded runs" value={runs.length} />
        <Metric
          icon={CheckCircle2}
          label="Completed"
          value={runs.filter((run) => run.status === "completed").length}
        />
        <Metric
          icon={AlertCircle}
          label="Needs attention"
          value={
            runs.filter(
              (run) => run.status === "failed" || run.status === "aborted",
            ).length
          }
        />
        <Metric
          icon={BrainCircuit}
          label="Skill reviews"
          value={skillRuns.length}
        />
      </section>

      <section className="trace-workbench">
        <aside className="trace-run-list" aria-label="Trace runs">
          <div className="trace-panel-heading">
            <div>
              <p className="trace-eyebrow">Runs</p>
              <h3>Recent activity</h3>
            </div>
            <span className="trace-run-count">
              {filteredRuns.length}/{runs.length}
            </span>
          </div>

          <label className="trace-run-search">
            <Search size={14} />
            <input
              value={runQuery}
              onChange={(event) => setRunQuery(event.target.value)}
              placeholder="Search requests, markers, events"
              aria-label="Search trace runs"
            />
          </label>

          {runQuery && filteredRuns.length === 0 ? (
            <EmptyState
              title="No matching runs"
              body="Try a prompt phrase, run marker, event type, or status."
            />
          ) : null}

          <div className="trace-run-results">
            {runs.length === 0 ? (
              <EmptyState title="No trace runs yet" />
            ) : (
              filteredRuns.map((run) => (
                <button
                  key={run.id}
                  className={`trace-run-row ${
                    selectedRun?.id === run.id ? "active" : ""
                  }`}
                  title={run.messagePreview}
                  onClick={() => selectRun(run)}
                >
                  <span className={`trace-status-dot ${run.status}`} />
                  <strong>{run.title}</strong>
                  <span>{run.profile}</span>
                  {run.messagePreview ? (
                    <small className="trace-run-preview">
                      {run.messagePreview}
                    </small>
                  ) : null}
                  <small>{formatTime(run.updatedAt)}</small>
                </button>
              ))
            )}
          </div>
        </aside>

        <article className="trace-detail" aria-label="Selected trace run">
          {selectedRun ? (
            <>
              <div className="trace-detail-title">
                <div>
                  <p className="trace-eyebrow">{selectedRun.profile}</p>
                  <h3 title={selectedRun.messagePreview}>
                    {selectedRun.title}
                  </h3>
                </div>
                <span className={`trace-status-pill ${selectedRun.status}`}>
                  {selectedRun.status}
                </span>
              </div>

              <section className="trace-request-preview">
                <p className="trace-eyebrow">Full Request</p>
                <p>{selectedRun.messagePreview}</p>
              </section>

              <RunMap run={selectedRun} />

              <div className="trace-facts">
                <Fact
                  label="Started"
                  value={formatTime(selectedRun.startedAt)}
                />
                <Fact
                  label="Updated"
                  value={formatTime(selectedRun.updatedAt)}
                />
                <Fact
                  label="Tokens"
                  value={String(selectedRun.usage?.totalTokens || 0)}
                />
                <Fact
                  label="Cost"
                  value={
                    selectedRun.usage?.cost != null
                      ? `$${selectedRun.usage.cost.toFixed(4)}`
                      : "n/a"
                  }
                />
              </div>

              <div className="trace-timeline">
                <div className="trace-section-title">
                  <p className="trace-eyebrow">Event Timeline</p>
                  <h3>Step-by-step evidence</h3>
                </div>
                {selectedRun.events.map((event) => (
                  <TraceEventRow
                    key={event.id}
                    event={event}
                    selected={event.id === selectedEvent?.id}
                    onSelect={() => setSelectedEventId(event.id)}
                  />
                ))}
              </div>
            </>
          ) : (
            <EmptyState title="No run selected" />
          )}
        </article>

        <aside className="trace-inspector" aria-label="Trace inspector">
          <div className="trace-panel-heading">
            <div>
              <p className="trace-eyebrow">Inspector</p>
              <h3>
                {selectedEvent ? selectedEvent.title : "No event selected"}
              </h3>
            </div>
          </div>

          {selectedRun && selectedEvent ? (
            <EventInspector run={selectedRun} event={selectedEvent} />
          ) : (
            <EmptyState title="No event selected" />
          )}

          <section
            className="skill-training-panel"
            aria-label="Skill Evaluation"
          >
            <div className="trace-panel-heading compact">
              <div>
                <p className="trace-eyebrow">Skill Evaluation</p>
                <h3>Learning signals</h3>
              </div>
            </div>

            {skillRuns.length === 0 ? (
              <div className="skill-training-empty">
                <BrainCircuit size={18} />
                <div>
                  <strong>No skill reviews yet</strong>
                  <p>
                    When Hermes evaluates a skill, this panel will show the
                    score, review status, and linked trace.
                  </p>
                </div>
              </div>
            ) : (
              skillRuns.map((run) => (
                <article className="skill-training-row" key={run.id}>
                  <div className="skill-training-row-top">
                    <span>{run.status}</span>
                    <strong>{run.skillName}</strong>
                  </div>
                  <div className="skill-score-track">
                    <div
                      style={{
                        width: `${Math.round((run.score || 0) * 100)}%`,
                      }}
                    />
                  </div>
                  <p>{run.summary}</p>
                </article>
              ))
            )}
          </section>
        </aside>
      </section>
    </div>
  );
}

function RunMap({ run }: { run: TraceRun }): React.JSX.Element {
  const steps = buildRunMap(run);
  return (
    <section className="trace-run-map" aria-label="Agent Run Map">
      <div className="trace-section-title">
        <div>
          <p className="trace-eyebrow">Agent Run Map</p>
          <h3>What Hermes did</h3>
        </div>
        <span className={`trace-map-status ${run.status}`}>{run.status}</span>
      </div>

      <div className="trace-map-grid">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div className="trace-map-step-wrap" key={step.key}>
              <article
                className={`trace-map-step ${step.event ? "complete" : "pending"} ${step.tone}`}
              >
                <span className="trace-map-step-icon">
                  <Icon size={16} />
                </span>
                <strong>{step.label}</strong>
                <p>{step.caption}</p>
                <small>
                  {step.event ? formatTime(step.event.timestamp) : "Waiting"}
                </small>
              </article>
              {index < steps.length - 1 ? (
                <ArrowRight className="trace-map-arrow" size={16} />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
}): React.JSX.Element {
  return (
    <div className="trace-metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="trace-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TraceEventRow({
  event,
  selected,
  onSelect,
}: {
  event: TraceEvent;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const Icon = EVENT_ICONS[event.type] || Activity;
  return (
    <button
      className={`trace-event-row ${selected ? "active" : ""}`}
      onClick={onSelect}
    >
      <span className="trace-event-time">{formatTime(event.timestamp)}</span>
      <span className={`trace-event-icon ${event.type.replace(".", "-")}`}>
        <Icon size={15} />
      </span>
      <span className="trace-event-copy">
        <strong>{event.title || EVENT_LABELS[event.type] || event.type}</strong>
        <small>{event.detail || EVENT_LABELS[event.type] || event.type}</small>
      </span>
    </button>
  );
}

function EventInspector({
  run,
  event,
}: {
  run: TraceRun;
  event: TraceEvent;
}): React.JSX.Element {
  const metadata = event.metadata ? Object.entries(event.metadata) : [];
  const narrative = explainEvent(run, event);
  return (
    <section className="event-inspector">
      <div className="trace-explainer-card primary">
        <span className="trace-explainer-icon">
          <MessageSquareText size={16} />
        </span>
        <div>
          <strong>What happened</strong>
          <p>{narrative.happened}</p>
        </div>
      </div>

      <div className="trace-explainer-card">
        <span className="trace-explainer-icon">
          <HelpCircle size={16} />
        </span>
        <div>
          <strong>Why it matters</strong>
          <p>{narrative.matters}</p>
        </div>
      </div>

      <div className="trace-raw-event">
        <span className={`trace-event-type ${event.type.replace(".", "-")}`}>
          {event.type}
        </span>
        <p>{event.detail || "No additional detail was recorded."}</p>
      </div>
      <div className="event-metadata">
        {metadata.length === 0 ? (
          <span>No metadata</span>
        ) : (
          metadata.map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{String(value)}</strong>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function buildRunMap(run: TraceRun): RunMapStep[] {
  const firstOf = (types: TraceEvent["type"][]): TraceEvent | undefined =>
    run.events.find((event) => types.includes(event.type));
  const anyTool = run.events.find((event) => event.type.includes("tool"));
  const anySkill = run.events.find((event) => event.type.startsWith("skill."));
  const anyFile =
    run.events.find((event) =>
      /file|edit|patch|write/i.test(event.detail || ""),
    ) || anyTool;

  return [
    {
      key: "ask",
      label: "Ask",
      caption: "The user's request was captured as the run goal.",
      event: firstOf(["message.user", "run.started"]),
      icon: FileSearch,
      tone: "blue",
    },
    {
      key: "plan",
      label: "Planning",
      caption: "Hermes framed the work before acting.",
      event: firstOf(["run.started"]),
      icon: Route,
      tone: "green",
    },
    {
      key: "tools",
      label: "Tool Calls",
      caption: anyTool
        ? "The agent used tools to inspect or change the workspace."
        : "No tool activity was emitted for this run.",
      event: anyTool,
      icon: Wrench,
      tone: anyTool ? "blue" : "neutral",
    },
    {
      key: "files",
      label: "Files Edited",
      caption: anyFile
        ? "Workspace changes are linked to the trace."
        : "No file edits were reported in this trace.",
      event: anyFile,
      icon: FileCode2,
      tone: anyFile ? "amber" : "neutral",
    },
    {
      key: "skills",
      label: "Skill Notes",
      caption: anySkill
        ? "A skill signal was captured for evaluation."
        : "No skill-learning signal was emitted yet.",
      event: anySkill,
      icon: BrainCircuit,
      tone: anySkill ? "green" : "neutral",
    },
    {
      key: "answer",
      label: "Answer",
      caption:
        run.status === "completed"
          ? "Hermes returned a completed response."
          : "Hermes has not completed this run yet.",
      event: firstOf(["run.completed", "run.failed", "run.aborted"]),
      icon:
        run.status === "completed"
          ? CheckCircle2
          : run.status === "running"
            ? Activity
            : AlertCircle,
      tone:
        run.status === "completed"
          ? "green"
          : run.status === "running"
            ? "blue"
            : "red",
    },
  ];
}

function explainEvent(run: TraceRun, event: TraceEvent): Narrative {
  switch (event.type) {
    case "run.started":
      return {
        happened: `Hermes started a new run for "${run.messagePreview || run.title}".`,
        matters:
          "This anchors every later action to one user-visible goal, so the trace can explain the full chain of work.",
      };
    case "message.user":
      return {
        happened: "The user's request was recorded before the agent acted.",
        matters:
          "Keeping the original request next to later actions makes it easier to judge whether the agent stayed on task.",
      };
    case "message.agent.delta":
      return {
        happened:
          event.title === "Agent response completed"
            ? "Hermes finished composing the response shown to the user."
            : "Hermes streamed part of its response.",
        matters:
          "Response events connect the final answer back to the decisions and tool activity that produced it.",
      };
    case "tool.progress":
      return {
        happened: event.detail || "Hermes reported progress from a tool call.",
        matters:
          "Tool events show when the agent touched external systems, files, commands, or project context.",
      };
    case "usage.recorded":
      return {
        happened: "Token and cost usage were attached to the run.",
        matters:
          "Usage data helps compare expensive runs with the quality and learning value they produced.",
      };
    case "run.completed":
      return {
        happened: "Hermes marked the run as completed.",
        matters:
          "Completed runs can be reviewed as examples for skill evaluation, regression checks, and future training notes.",
      };
    case "run.failed":
    case "run.aborted":
      return {
        happened: "Hermes stopped before a successful completion.",
        matters:
          "Failed traces are useful training material because they show where the agent or tools need better recovery behavior.",
      };
    case "skill.used":
    case "skill.eval":
    case "skill.promoted":
    case "skill.rejected":
      return {
        happened: event.detail || "Hermes emitted a skill-learning event.",
        matters:
          "Skill events connect individual runs to the self-improvement loop so users can review what should be reused.",
      };
    default:
      return {
        happened: event.detail || "Hermes recorded this event in the trace.",
        matters:
          "Each event is evidence that helps explain what the agent did, why it did it, and what should improve next time.",
      };
  }
}

function traceRunMatchesSearch(run: TraceRun, query: string): boolean {
  const searchable = [
    run.title,
    run.messagePreview,
    run.profile,
    run.status,
    run.sessionId || "",
    String(run.usage?.totalTokens || ""),
    String(run.usage?.cost || ""),
    ...run.events.flatMap((event) => [
      event.title,
      event.detail || "",
      event.type,
      safeStringify(event.metadata || {}),
    ]),
  ]
    .join("\n")
    .toLowerCase();
  return searchable.includes(query);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body?: string;
}): React.JSX.Element {
  return (
    <section className="trace-empty">
      <Clock3 size={20} />
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </section>
  );
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default TraceLab;
