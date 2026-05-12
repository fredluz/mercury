import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  Gauge,
  RefreshCw,
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

function TraceLab(): React.JSX.Element {
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [skillRuns, setSkillRuns] = useState<SkillTrainingRun[]>([]);
  const [loading, setLoading] = useState(true);

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

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId],
  );

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
          <p className="trace-eyebrow">Observability</p>
          <h2>Trace Lab</h2>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={15} />
          Refresh
        </button>
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
          label="Skill loops"
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
          </div>

          {runs.length === 0 ? (
            <EmptyState title="No trace runs yet" />
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                className={`trace-run-row ${
                  selectedRun?.id === run.id ? "active" : ""
                }`}
                onClick={() => selectRun(run)}
              >
                <span className={`trace-status-dot ${run.status}`} />
                <strong>{run.title}</strong>
                <span>{run.profile}</span>
                <small>{formatTime(run.updatedAt)}</small>
              </button>
            ))
          )}
        </aside>

        <article className="trace-detail" aria-label="Selected trace run">
          {selectedRun ? (
            <>
              <div className="trace-detail-title">
                <div>
                  <p className="trace-eyebrow">{selectedRun.profile}</p>
                  <h3>{selectedRun.title}</h3>
                </div>
                <span className={`trace-status-pill ${selectedRun.status}`}>
                  {selectedRun.status}
                </span>
              </div>

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

          {selectedEvent ? (
            <EventInspector event={selectedEvent} />
          ) : (
            <EmptyState title="No event selected" />
          )}

          <section className="skill-training-panel">
            <div className="trace-panel-heading compact">
              <div>
                <p className="trace-eyebrow">Skill Training</p>
                <h3>Review queue</h3>
              </div>
            </div>

            {skillRuns.length === 0 ? (
              <p className="trace-muted">No skill training runs emitted yet.</p>
            ) : (
              skillRuns.map((run) => (
                <article className="skill-training-row" key={run.id}>
                  <span>{run.status}</span>
                  <strong>{run.skillName}</strong>
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

function EventInspector({ event }: { event: TraceEvent }): React.JSX.Element {
  const metadata = event.metadata ? Object.entries(event.metadata) : [];
  return (
    <section className="event-inspector">
      <span className={`trace-event-type ${event.type.replace(".", "-")}`}>
        {event.type}
      </span>
      <p>{event.detail || "No additional detail was recorded."}</p>
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
