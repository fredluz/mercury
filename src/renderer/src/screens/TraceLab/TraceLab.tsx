import { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, BookOpenCheck, BrainCircuit, CheckCircle2, Link2, RefreshCw, Route, Search } from "lucide-react";
import type {
  SkillTrainingRun,
  TraceRun,
} from "../../../../shared/traces";

import { EmptyState, EventInspector, Fact, Metric, RunMap, SkillTraceSummary, TraceEventRow } from "./components/TraceLabComponents";
import { RUN_FILTERS, type RunFilter } from "./trace-lab.types";
import { formatTime, traceRunMatchesFilter, traceRunMatchesSearch } from "./trace-lab.helpers";
function TraceLab(): React.JSX.Element {
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
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
    return runs.filter(
      (run) =>
        traceRunMatchesFilter(run, runFilter) &&
        (!query || traceRunMatchesSearch(run, query)),
    );
  }, [runFilter, runQuery, runs]);

  const selectedRun = useMemo(() => {
    const selected = runs.find((run) => run.id === selectedRunId) || null;
    if (selected && filteredRuns.some((run) => run.id === selected.id)) {
      return selected;
    }
    return filteredRuns[0] || runs[0] || null;
  }, [filteredRuns, runs, selectedRunId]);

  const selectedEvent = useMemo(() => {
    if (!selectedRun) return null;
    return (
      selectedRun.events.find((event) => event.id === selectedEventId) ||
      selectedRun.events[0] ||
      null
    );
  }, [selectedEventId, selectedRun]);

  const selectedRunSkillRuns = useMemo(() => {
    if (!selectedRun) return [];
    return skillRuns.filter((run) => run.linkedRunId === selectedRun.id);
  }, [selectedRun, skillRuns]);

  function selectRun(run: TraceRun): void {
    setSelectedRunId(run.id);
    setSelectedEventId(run.events[0]?.id || null);
  }

  function selectSkillRun(skillRun: SkillTrainingRun): void {
    const linkedRun = runs.find((run) => run.id === skillRun.linkedRunId);
    if (!linkedRun) return;
    setSelectedRunId(linkedRun.id);
    setSelectedEventId(skillRun.id);
    if (runFilter !== "all" && !traceRunMatchesFilter(linkedRun, runFilter)) {
      setRunFilter("all");
    }
    setRunQuery("");
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

          <div className="trace-run-filters" aria-label="Trace run filters">
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

              <SkillTraceSummary
                skillRuns={selectedRunSkillRuns}
                onSelect={(skillRun) => setSelectedEventId(skillRun.id)}
              />

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
                <button
                  className={`skill-training-row ${
                    selectedEvent?.id === run.id ? "active" : ""
                  }`}
                  key={run.id}
                  onClick={() => selectSkillRun(run)}
                >
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
                  {run.linkedRunId ? (
                    <small>
                      <Link2 size={12} />
                      Opens linked trace
                    </small>
                  ) : null}
                </button>
              ))
            )}
          </section>
        </aside>
      </section>
    </div>
  );
}

export default TraceLab;
