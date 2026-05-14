import type React from "react";
import { Activity, ArrowRight, Clock3, ExternalLink, FileImage, HelpCircle, MessageSquareText } from "lucide-react";
import type { SkillTrainingRun, TraceEvent, TraceRun } from "../../../../../shared/traces";
import { EVENT_ICONS, EVENT_LABELS } from "../trace-lab.types";
import { buildRunMap, explainEvent, formatSkillScore, formatTime, safeStringify } from "../trace-lab.helpers";

export function SkillTraceSummary({
  skillRuns,
  onSelect,
}: {
  skillRuns: SkillTrainingRun[];
  onSelect: (run: SkillTrainingRun) => void;
}): React.JSX.Element {
  return (
    <section className="trace-skill-summary" aria-label="Skill learning links">
      <div className="trace-section-title">
        <div>
          <p className="trace-eyebrow">Skill Auto-Evolution</p>
          <h3>What Hermes learned</h3>
        </div>
        <span>{skillRuns.length} signals</span>
      </div>

      {skillRuns.length === 0 ? (
        <p className="trace-muted">
          No skill-learning signal is linked to this run yet.
        </p>
      ) : (
        <div className="trace-skill-links">
          {skillRuns.map((run) => (
            <button key={run.id} onClick={() => onSelect(run)}>
              <span className={`skill-status-chip ${run.status}`}>
                {run.status}
              </span>
              <strong>{run.skillName}</strong>
              <small>{formatSkillScore(run.score)}</small>
              <p>{run.summary}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function RunMap({ run }: { run: TraceRun }): React.JSX.Element {
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

export function Metric({
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

export function Fact({
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

export function TraceEventRow({
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
      <span className={`trace-event-icon ${event.type.replace(/\./g, "-")}`}>
        <Icon size={15} />
      </span>
      <span className="trace-event-copy">
        <strong>{event.title || EVENT_LABELS[event.type] || event.type}</strong>
        <small>{event.detail || EVENT_LABELS[event.type] || event.type}</small>
      </span>
    </button>
  );
}

export function EventInspector({
  run,
  event,
}: {
  run: TraceRun;
  event: TraceEvent;
}): React.JSX.Element {
  const metadata = event.metadata ? Object.entries(event.metadata) : [];
  const narrative = explainEvent(run, event);
  const artifact = event.type === "artifact.created" ? getArtifactDetails(event) : null;
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
        <span className={`trace-event-type ${event.type.replace(/\./g, "-")}`}>
          {event.type}
        </span>
        <p>{event.detail || "No additional detail was recorded."}</p>
      </div>

      {artifact ? <ArtifactInspector artifact={artifact} /> : null}

      <div className="event-metadata">
        {metadata.length === 0 ? (
          <span>No metadata</span>
        ) : (
          metadata.map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{formatMetadataValue(value)}</strong>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

type ArtifactDetails = {
  type: string;
  reference: string;
  openTarget?: string;
  source?: string;
};

function ArtifactInspector({ artifact }: { artifact: ArtifactDetails }): React.JSX.Element {
  function openArtifact(): void {
    if (!artifact.openTarget) return;
    void window.hermesAPI.openExternal(artifact.openTarget).catch((error) => {
      console.warn("Failed to open trace artifact", error);
    });
  }

  return (
    <div className="trace-artifact-card">
      <span className="trace-artifact-icon">
        <FileImage size={17} />
      </span>
      <div className="trace-artifact-copy">
        <strong>{artifact.type} artifact</strong>
        {artifact.source ? <small>{artifact.source}</small> : null}
        <p>{artifact.reference}</p>
      </div>
      {artifact.openTarget ? (
        <button className="trace-artifact-open" onClick={openArtifact}>
          <ExternalLink size={14} />
          Open artifact
        </button>
      ) : (
        <span className="trace-artifact-unavailable">Display only</span>
      )}
    </div>
  );
}

function getArtifactDetails(event: TraceEvent): ArtifactDetails | null {
  const metadata = event.metadata || {};
  const url = metadata.url;
  const path = metadata.path;
  const artifact = metadata.artifact;
  const output = metadata.output;
  const result = metadata.result;
  const reference = firstString(url, path, artifact, output, result, event.detail);
  if (!reference) return null;
  const artifactType = firstString(metadata.artifactType, metadata.type) || "Generated";
  const openTarget = artifactOpenTarget(url, path, reference);
  return {
    type: artifactType,
    reference,
    openTarget,
    source: firstString(metadata.source),
  };
}

function artifactOpenTarget(
  url: unknown,
  path: unknown,
  reference: string,
): string | undefined {
  const target = firstString(url, path, reference);
  if (!target) return undefined;
  if (/^https?:\/\//i.test(target) || /^file:\/\//i.test(target)) return target;
  if (target.startsWith("/")) return `file://${encodeURI(target)}`;
  if (/^[A-Za-z]:[\\/]/.test(target)) {
    return `file:///${encodeURI(target.replace(/\\/g, "/"))}`;
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function formatMetadataValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeStringify(value);
}

export function EmptyState({
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
