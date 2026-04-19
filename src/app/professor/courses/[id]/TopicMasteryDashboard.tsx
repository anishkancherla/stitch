"use client";

import { useMemo, useState } from "react";

export type TopicTier = "weak" | "mid" | "strong";

export type SubtopicRow = {
  subconceptId: string;
  label: string;
  /** 0..1 mean of per-student means for this subconcept. Null when N=0. */
  avgMastery: number | null;
  /** Number of students with any mastery record on this subconcept. */
  totalStudents: number;
  /** Number of students sitting in the weak tier (<40%) for this subconcept. */
  strugglingCount: number;
  /** Tier of the subconcept itself, derived from avgMastery. */
  tier: TopicTier | null;
};

export type TopicCard = {
  conceptId: string;
  label: string;
  /** e.g. "Week 3 · Backpropagation". Null when no lecture is attached yet. */
  weekLabel: string | null;
  /** 0..1 mean of per-student means. Null when no students have any data. */
  avgMastery: number | null;
  /** 0..1 fraction of students sitting in the weak tier. Null when N=0. */
  strugglingFrac: number | null;
  studentCounts: { strong: number; mid: number; weak: number };
  totalStudents: number;
  strugglingCount: number;
  /** Tier of the topic itself, derived from avgMastery using the same cuts. */
  tier: TopicTier | null;
  /** Per-subconcept breakdown, sorted weakest-first for the detail panel. */
  subtopics: SubtopicRow[];
};

type Metric = "avg" | "struggling";

type Props = {
  classAvgMastery: number | null;
  strugglingStudents: number;
  weakestTopic: TopicCard | null;
  strongestTopic: TopicCard | null;
  topics: TopicCard[];
};

// One source of truth for the three-tier color encoding. Each tier returns
// the swatches we paint pills, bars, and stat values with — text labels are
// always paired with these colors elsewhere so we never lean on hue alone.
const TIER_STYLES: Record<
  TopicTier,
  { pill: string; bar: string; text: string; dot: string; label: string }
> = {
  weak: {
    pill: "bg-rose-100 text-rose-700",
    bar: "bg-rose-400",
    text: "text-rose-600",
    dot: "bg-rose-400",
    label: "Weak",
  },
  mid: {
    pill: "bg-amber-100 text-amber-800",
    bar: "bg-amber-400",
    text: "text-amber-700",
    dot: "bg-amber-400",
    label: "Mid",
  },
  strong: {
    pill: "bg-emerald-100 text-emerald-700",
    bar: "bg-emerald-500",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    label: "Strong",
  },
};

const NO_DATA_STYLE = {
  pill: "bg-zinc-100 text-zinc-500",
  bar: "bg-zinc-300",
  text: "text-muted",
  dot: "bg-zinc-300",
};

function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function tierFromAvg(v: number | null): TopicTier | null {
  if (v === null) return null;
  if (v < 0.4) return "weak";
  if (v < 0.7) return "mid";
  return "strong";
}

export function TopicMasteryDashboard({
  classAvgMastery,
  strugglingStudents,
  weakestTopic,
  strongestTopic,
  topics,
}: Props) {
  const [metric, setMetric] = useState<Metric>("avg");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const expanded = useMemo(
    () => topics.find((t) => t.conceptId === expandedId) ?? null,
    [topics, expandedId]
  );

  return (
    <section className="mt-10 flex flex-col gap-8">
      {/* ---------- Section 1: summary stat strip ---------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Class avg mastery"
          value={pct(classAvgMastery)}
        />
        <StatCard
          label="Struggling students"
          value={String(strugglingStudents)}
          valueClass="text-rose-600"
          subtitle={
            strugglingStudents === 1
              ? "below 40% mastery"
              : "below 40% mastery"
          }
        />
        <StatCard
          label="Weakest topic"
          value={weakestTopic ? weakestTopic.label : "—"}
          valueClass="text-base font-medium"
          truncate
          subtitle={
            weakestTopic ? `${pct(weakestTopic.avgMastery)} avg` : undefined
          }
          subtitleClass="text-rose-600"
        />
        <StatCard
          label="Strongest topic"
          value={strongestTopic ? strongestTopic.label : "—"}
          valueClass="text-base font-medium"
          truncate
          subtitle={
            strongestTopic ? `${pct(strongestTopic.avgMastery)} avg` : undefined
          }
          subtitleClass="text-emerald-700"
        />
      </div>

      {/* ---------- Section 2: topic mastery grid ---------- */}
      <div>
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="text-base font-medium text-foreground">
            Topic mastery
          </h2>

          <div className="flex flex-wrap items-center gap-3">
            <Legend />
            <div className="flex items-center gap-1 rounded-full border border-border bg-zinc-50 p-0.5 text-xs">
              <ToggleButton
                active={metric === "avg"}
                onClick={() => setMetric("avg")}
              >
                Avg mastery
              </ToggleButton>
              <ToggleButton
                active={metric === "struggling"}
                onClick={() => setMetric("struggling")}
              >
                % struggling
              </ToggleButton>
            </div>
          </div>
        </div>

        {topics.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-zinc-50 px-5 py-12 text-center text-sm text-muted">
            Concepts exist but no lectures have been uploaded yet.
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {topics.map((t) => (
                <TopicCardView
                  key={t.conceptId}
                  topic={t}
                  metric={metric}
                  isExpanded={expandedId === t.conceptId}
                  onClick={() =>
                    setExpandedId((curr) =>
                      curr === t.conceptId ? null : t.conceptId
                    )
                  }
                />
              ))}
            </div>

            {expanded && (
              <DetailPanel
                topic={expanded}
                metric={metric}
                onClose={() => setExpandedId(null)}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ---------- Subcomponents ----------

function StatCard({
  label,
  value,
  valueClass,
  subtitle,
  subtitleClass,
  truncate,
}: {
  label: string;
  value: string;
  valueClass?: string;
  subtitle?: string;
  subtitleClass?: string;
  truncate?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="text-[12px] uppercase tracking-wider text-muted">
        {label}
      </div>
      <div
        className={[
          "mt-2 font-display text-2xl tracking-tight text-foreground",
          truncate ? "truncate" : "",
          valueClass ?? "",
        ].join(" ")}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
      {subtitle && (
        <div className={["mt-1 text-xs", subtitleClass ?? "text-muted"].join(" ")}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1 transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted">
      {(["weak", "mid", "strong"] as TopicTier[]).map((tier) => (
        <span key={tier} className="inline-flex items-center gap-1.5">
          <span
            className={`block h-2.5 w-2.5 rounded-[3px] ${TIER_STYLES[tier].dot}`}
          />
          {tier === "weak"
            ? "Weak <40%"
            : tier === "mid"
              ? "Mid 40–69%"
              : "Strong 70%+"}
        </span>
      ))}
    </div>
  );
}

function TopicCardView({
  topic,
  metric,
  isExpanded,
  onClick,
}: {
  topic: TopicCard;
  metric: Metric;
  isExpanded: boolean;
  onClick: () => void;
}) {
  // Pill / bar always reflect the topic's own mastery tier — that's the
  // "warning level" of the topic, regardless of which metric is on display.
  const styles = topic.tier ? TIER_STYLES[topic.tier] : NO_DATA_STYLE;

  // The displayed value + bar fill swap with the toggle; the tier color
  // stays the same so the at-a-glance read of the grid doesn't flicker.
  let displayValue: string;
  let fillPct: number;
  if (metric === "avg") {
    displayValue = pct(topic.avgMastery);
    fillPct = (topic.avgMastery ?? 0) * 100;
  } else {
    displayValue = pct(topic.strugglingFrac);
    fillPct = (topic.strugglingFrac ?? 0) * 100;
  }
  fillPct = Math.max(0, Math.min(100, fillPct));

  const showNeedsAttention = topic.tier === "weak";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group rounded-2xl border bg-background p-4 text-left transition-colors",
        isExpanded
          ? "border-foreground/30 ring-1 ring-foreground/20"
          : "border-border hover:border-foreground/20",
      ].join(" ")}
      aria-expanded={isExpanded}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            {topic.label}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            {topic.weekLabel ?? "Unscheduled"}
          </div>
        </div>
        <span
          className={[
            "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
            styles.pill,
          ].join(" ")}
        >
          {displayValue}
        </span>
      </div>

      {/* Thin progress bar in tier color */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full ${styles.bar} transition-[width] duration-300`}
          style={{ width: `${fillPct}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted">
          {topic.totalStudents === 0
            ? "No data yet"
            : `${topic.strugglingCount} ${
                topic.strugglingCount === 1 ? "student" : "students"
              } struggling`}
        </span>
        {showNeedsAttention && (
          <span className="font-medium text-rose-600">Needs attention</span>
        )}
      </div>
    </button>
  );
}

function DetailPanel({
  topic,
  metric,
  onClose,
}: {
  topic: TopicCard;
  metric: Metric;
  onClose: () => void;
}) {
  const total = topic.totalStudents;
  const rows: Array<{
    tier: TopicTier;
    count: number;
    label: string;
  }> = [
    { tier: "strong", count: topic.studentCounts.strong, label: "Strong" },
    { tier: "mid", count: topic.studentCounts.mid, label: "Mid" },
    { tier: "weak", count: topic.studentCounts.weak, label: "Weak" },
  ];

  return (
    <div className="mt-4 rounded-2xl border border-border bg-zinc-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-xl tracking-tight text-foreground">
            {topic.label}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {topic.weekLabel ?? "Unscheduled"}
            {" · "}
            {total} {total === 1 ? "student" : "students"} with data
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full px-2 py-1 text-sm text-muted hover:bg-zinc-100 hover:text-foreground"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {rows.map((r) => {
          const styles = TIER_STYLES[r.tier];
          const fill = total > 0 ? (r.count / total) * 100 : 0;
          return (
            <div
              key={r.tier}
              className="grid grid-cols-[64px_1fr_auto] items-center gap-3"
            >
              <span className="text-xs font-medium text-foreground">
                {r.label}
              </span>
              <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-border/60">
                <div
                  className={`h-full rounded-full ${styles.bar}`}
                  style={{ width: `${fill}%` }}
                />
              </div>
              <span className="font-mono text-xs tabular-nums text-foreground">
                {r.count}
              </span>
            </div>
          );
        })}
      </div>

      <SubtopicBreakdown subtopics={topic.subtopics} metric={metric} />

      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton
          onClick={() => {
            // Stub: wire to an LLM/server action later. We keep the UI
            // contract here so the surface is testable end-to-end first.
            console.log("Generate practice problems for", topic.label);
            alert(`Generate practice problems for "${topic.label}"`);
          }}
        >
          Generate practice problems
        </ActionButton>
        <ActionButton
          variant="ghost"
          onClick={() => {
            console.log("Get teaching tips for", topic.label);
            alert(`Get teaching tips for "${topic.label}"`);
          }}
        >
          Get teaching tips
        </ActionButton>
      </div>
    </div>
  );
}

function SubtopicBreakdown({
  subtopics,
  metric,
}: {
  subtopics: SubtopicRow[];
  metric: Metric;
}) {
  // The metric toggle in the parent dashboard drives both what we show on
  // each row and the row order — when a professor flips to "% struggling"
  // they expect the most-struggled-with subtopic to bubble to the top.
  const sorted = useMemo(() => {
    const withFrac = subtopics.map((s) => ({
      ...s,
      strugglingFrac:
        s.totalStudents > 0 ? s.strugglingCount / s.totalStudents : null,
    }));

    return withFrac.sort((a, b) => {
      const aHas = a.totalStudents > 0;
      const bHas = b.totalStudents > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (!aHas) return a.label.localeCompare(b.label);

      if (metric === "struggling") {
        // Highest struggling fraction first; ties broken by avg mastery
        // (lower is "worse") so the order still reads as severity.
        const af = a.strugglingFrac ?? 0;
        const bf = b.strugglingFrac ?? 0;
        if (af !== bf) return bf - af;
        return (a.avgMastery ?? 0) - (b.avgMastery ?? 0);
      }
      return (a.avgMastery ?? 0) - (b.avgMastery ?? 0);
    });
  }, [subtopics, metric]);

  if (subtopics.length === 0) return null;

  const noData = subtopics.filter((s) => s.totalStudents === 0).length;
  const headerLabel =
    metric === "struggling"
      ? "Subtopics — most struggling first"
      : "Subtopics — weakest first";

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {headerLabel}
        </h4>
        {noData > 0 && (
          <span className="text-[11px] text-muted">
            {noData} with no data yet
          </span>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-background">
        {sorted.map((s) => {
          // Pill / bar always carry the topic-style tier color (derived
          // from avg mastery) so the visual "warning level" of a subtopic
          // doesn't change with the toggle — only the displayed number,
          // bar fill, and order do.
          const styles = s.tier ? TIER_STYLES[s.tier] : NO_DATA_STYLE;

          const displayValue =
            metric === "struggling"
              ? pct(s.strugglingFrac)
              : pct(s.avgMastery);
          const rawFill =
            metric === "struggling"
              ? (s.strugglingFrac ?? 0) * 100
              : (s.avgMastery ?? 0) * 100;
          const fillPct = Math.max(0, Math.min(100, rawFill));

          return (
            <li
              key={s.subconceptId}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] text-foreground">
                  {s.label}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {s.totalStudents === 0
                    ? "No data yet"
                    : `${s.strugglingCount} of ${s.totalStudents} struggling · ${pct(s.avgMastery)} avg`}
                </div>
              </div>
              <span
                className={[
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                  styles.pill,
                ].join(" ")}
              >
                {displayValue}
              </span>
              <div className="col-span-2 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className={`h-full rounded-full ${styles.bar} transition-[width] duration-300`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionButton({
  onClick,
  variant = "solid",
  children,
}: {
  onClick: () => void;
  variant?: "solid" | "ghost";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        variant === "solid"
          ? "bg-foreground text-background hover:opacity-90"
          : "border border-border bg-background text-foreground hover:bg-zinc-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// Re-export the tier helper in case other call sites need to compute the
// same buckets — keeps the cut points colocated with the styling.
export { tierFromAvg };
