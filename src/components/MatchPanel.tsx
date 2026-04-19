"use client";

import { useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { getMatchesForConcept } from "@/app/student/courses/[id]/actions";
import { startStitchSpaceForm } from "@/app/space/[id]/actions";
import type { MatchResult } from "@/lib/matching";
import { cellHex } from "@/lib/ribbon";

export interface MatchPanelProps {
  courseId: string;
  /** Currently focused concept (always set when the panel mounts). */
  conceptId: string;
  /** Optional finer focus inside the expanded concept. */
  subconceptId: string | null;
  /** Label of the focused concept — for the panel header. */
  conceptLabel: string;
  /** Label of the focused subconcept, if any. */
  subconceptLabel?: string | null;
  onClose: () => void;
}

export function MatchPanel({
  courseId,
  conceptId,
  subconceptId,
  conceptLabel,
  subconceptLabel,
  onClose,
}: MatchPanelProps) {
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-fetch whenever the focus changes. The server action re-runs the
  // ranking against the current mastery snapshot, so peers' bars stay
  // honest even if a classmate just bumped their own scores.
  useEffect(() => {
    setError(null);
    startTransition(async () => {
      const res = await getMatchesForConcept(
        courseId,
        conceptId,
        subconceptId ?? null
      );
      if (!res.ok) {
        setError(res.error);
        setMatches([]);
      } else {
        setMatches(res.matches);
      }
    });
  }, [courseId, conceptId, subconceptId]);

  const focusedLabel = subconceptLabel
    ? `${conceptLabel} · ${subconceptLabel}`
    : conceptLabel;

  return (
    <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            Stitches
          </p>
          <h3 className="mt-0.5 truncate font-display text-xl text-foreground">
            {focusedLabel}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {subconceptId
              ? "Top classmates strong on this subconcept"
              : "Top classmates strong across this concept"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted hover:text-foreground"
          aria-label="Close stitches panel"
        >
          Close
        </button>
      </div>

      <div className="mt-4">
        {pending && matches === null && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-zinc-100"
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-rose-500">Couldn&apos;t load stitches: {error}</p>
        )}

        {matches !== null && matches.length === 0 && !error && (
          <p className="text-sm text-muted">
            No stitches yet. Either no one is strong here, or no classmates
            are enrolled.
          </p>
        )}

        {matches !== null && matches.length > 0 && (
          <ul className="space-y-2">
            {matches.map((m) => (
              <MatchRow key={m.userId} match={m} courseId={courseId} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MatchRow({
  match,
  courseId,
}: {
  match: MatchResult;
  courseId: string;
}) {
  const initials = monogram(match.name);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-zinc-50 px-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {match.name}
          </p>
          <p className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
            score {match.score.toFixed(2)}
          </p>
        </div>

        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
          <MasteryDots theirs={match.theirMastery} mine={match.myMastery} />
          <span className="shrink-0 font-mono">
            them {match.theirMastery.toFixed(2)} · you {match.myMastery.toFixed(2)}
          </span>
        </div>

        {match.reciprocalSubconcept && (
          <p className="mt-1 truncate text-[11px] text-muted">
            <span className="text-foreground">You can teach them:</span>{" "}
            {match.reciprocalSubconcept.label}
          </p>
        )}

        <AvailabilityChips
          blocks={match.availabilityOverlap}
          totalHours={match.overlapHours}
        />
      </div>

      <StartSpaceButton courseId={courseId} partnerUserId={match.userId} />
    </li>
  );
}

// Form action — server creates the space + plan, then redirects the
// requester into /space/[id]. Plan generation can take 5-10s; the
// pending state covers that window.
function StartSpaceButton({
  courseId,
  partnerUserId,
}: {
  courseId: string;
  partnerUserId: string;
}) {
  return (
    <form action={startStitchSpaceForm} className="shrink-0">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="partnerUserId" value={partnerUserId} />
      <SpaceSubmitButton />
    </form>
  );
}

function SpaceSubmitButton() {
  // useFormStatus must be a child of the <form> to bind correctly.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Building…" : "Start Stitch Space"}
    </button>
  );
}

// Two side-by-side bars that visualise the "teach gap" — their bar minus
// mine. Wider their-bar = more upside in the match.
function MasteryDots({ theirs, mine }: { theirs: number; mine: number }) {
  return (
    <span className="flex h-2 w-24 overflow-hidden rounded-full bg-zinc-200">
      <span
        className="block h-full"
        style={{ width: `${Math.round(mine * 100)}%`, backgroundColor: cellHex(mine) }}
      />
      <span
        className="block h-full opacity-60"
        style={{
          width: `${Math.max(0, Math.round((theirs - mine) * 100))}%`,
          backgroundColor: cellHex(theirs),
        }}
      />
    </span>
  );
}

function AvailabilityChips({
  blocks,
  totalHours,
}: {
  blocks: { day: string; start: string; end: string }[];
  totalHours: number;
}) {
  if (blocks.length === 0) {
    return (
      <p className="mt-1 text-[11px] text-muted/70">
        No shared availability set
      </p>
    );
  }

  // Show up to 3 chips inline; "+N more" rolls up the rest. Keeps the row
  // height stable when a match is free all week.
  const visible = blocks.slice(0, 3);
  const extra = blocks.length - visible.length;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {visible.map((b, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700"
        >
          {b.day} {b.start}–{b.end}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-muted">+{extra} more</span>
      )}
      <span className="ml-auto text-[10px] text-muted">
        {totalHours.toFixed(1)}h/wk
      </span>
    </div>
  );
}
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

