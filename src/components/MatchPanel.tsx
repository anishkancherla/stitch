"use client";

import { useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { getMatchesForConcept } from "@/app/student/courses/[id]/actions";
import { startStitchSpaceForm } from "@/app/space/[id]/actions";
import type { MatchResult } from "@/lib/matching";

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
  const [myMastery, setMyMastery] = useState<number | null>(null);
  const [alreadyStrong, setAlreadyStrong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-fetch whenever the focus changes. The server action re-runs the
  // ranking against the current mastery snapshot, so peers' bars stay
  // honest even if a classmate just bumped their own scores. Top 3 only —
  // any more and the panel turns into a wall of names.
  useEffect(() => {
    setError(null);
    startTransition(async () => {
      const res = await getMatchesForConcept(
        courseId,
        conceptId,
        subconceptId ?? null,
        3
      );
      if (!res.ok) {
        setError(res.error);
        setMatches([]);
        setMyMastery(null);
        setAlreadyStrong(false);
      } else {
        setMatches(res.matches);
        setMyMastery(res.myFocusMastery);
        setAlreadyStrong(res.alreadyStrong);
      }
    });
  }, [courseId, conceptId, subconceptId]);

  const focusedLabel = subconceptLabel
    ? `${conceptLabel} · ${subconceptLabel}`
    : conceptLabel;

  return (
    <div className="rounded-3xl border border-border bg-background p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Chip-style header — colored dot + "Stitches" label, picking
              up the same accent language as the step chips. */}
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />
            Stitches
          </span>
          <h3 className="mt-3 truncate font-inter text-2xl font-semibold tracking-tight text-foreground">
            {focusedLabel}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {alreadyStrong
              ? "You're already strong here"
              : "Top 3 mutual stitches — they fill your gap, you fill theirs"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-sm text-muted hover:text-foreground"
          aria-label="Close stitches panel"
        >
          Close
        </button>
      </div>

      <div className="mt-5">
        {pending && matches === null && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl bg-zinc-100"
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-rose-500">
            Couldn&apos;t load stitches: {error}
          </p>
        )}

        {/* Strong-cell branch: no list, just a friendly nudge to flip to a
            weaker cell. Stitch is a peer-tutoring tool — there's nothing
            useful for someone strong on a topic to learn from someone
            stronger. We surface that explicitly so the user understands
            why the panel is empty. */}
        {!pending && alreadyStrong && (
          <div className="flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50/60 px-6 py-8 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-800">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Mastered
            </span>
            <p className="mt-3 text-base font-medium text-emerald-900">
              You&apos;ve got this one locked in
              {myMastery !== null && (
                <span className="font-mono text-emerald-800/80">
                  {" "}
                  ({myMastery.toFixed(2)})
                </span>
              )}
              .
            </p>
            <p className="mt-1.5 max-w-sm text-sm text-emerald-800/80">
              Stitch finds tutors for areas you&apos;re weak in. Click a
              red or yellow cell on your ribbon to see classmates you can
              study with.
            </p>
          </div>
        )}

        {!pending && !alreadyStrong && matches !== null && matches.length === 0 && !error && (
          <p className="text-sm text-muted">
            No stitches yet. Either no one is strong here, or no
            classmates are enrolled.
          </p>
        )}

        {!alreadyStrong && matches !== null && matches.length > 0 && (
          <ul className="space-y-3">
            {matches.map((m, idx) => (
              <MatchCard
                key={m.userId}
                match={m}
                rank={idx + 1}
                courseId={courseId}
                conceptId={conceptId}
                subconceptId={subconceptId}
                focusedTopic={subconceptLabel || conceptLabel}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One classmate card. Frames the match as a two-way swap, not a one-way
// "they're stronger than me" rank:
//   1. Avatar + name + rank chip + Start button.
//   2. The swap block — two arrows showing what each side teaches the
//      other. The "they teach you" topic is whatever cell the requester
//      clicked (so it's the same across cards in a panel); the "you
//      teach them" topic is the matcher's reciprocal pick (different
//      per card, sometimes null when no clean swap exists).
//   3. Schedule overlap as a footer chip (or a muted "no shared
//      availability" when neither side has set a calendar).
//
// We deliberately don't surface raw mastery numbers here. The swap block
// uses qualitative Strong/Weak/Mid pills tied to the same thresholds the
// ribbon legend uses, so the language matches what the student already
// reads on their own ribbon.
// ---------------------------------------------------------------------------

function MatchCard({
  match,
  rank,
  courseId,
  conceptId,
  subconceptId,
  focusedTopic,
}: {
  match: MatchResult;
  rank: number;
  courseId: string;
  /** Click-context — passed to the Start button so the generated space is
   *  scoped to the cell the requester focused on, not pair-wide. */
  conceptId: string;
  subconceptId: string | null;
  /** Label of the cell the student clicked (subconcept if drilled in,
   *  otherwise the concept). Used as the "they teach you" topic. */
  focusedTopic: string;
}) {
  const initials = monogram(match.name);
  const firstName = match.name.split(" ")[0] || match.name;
  const theirLevelOnFocus = bucketLabel(match.theirMastery);

  return (
    <li className="rounded-2xl border border-border bg-zinc-50/60 p-5 transition-colors hover:bg-zinc-50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-foreground">
              {match.name}
            </p>
            <RankChip rank={rank} />
          </div>
        </div>
        <StartSpaceButton
          courseId={courseId}
          partnerUserId={match.userId}
          conceptId={conceptId}
          subconceptId={subconceptId}
        />
      </div>

      {/* The swap block. The "←" row is what's coming TO you (always shown,
          since by construction every match in this list is at-or-above
          you on the focused topic). The "→" row is what's going FROM you
          to them — gated on the matcher actually finding a subconcept
          where you're strong AND they're weak. When the swap is one-sided
          we fall back to a gentler "you're mostly here to learn" line so
          the card never looks broken. */}
      <div className="mt-4 space-y-2 rounded-xl border border-border bg-background p-3.5">
        <SwapRow
          direction="incoming"
          who="They teach you"
          topic={focusedTopic}
          level={theirLevelOnFocus}
        />
        {match.reciprocalSubconcept ? (
          <SwapRow
            direction="outgoing"
            who={`You teach ${firstName}`}
            topic={match.reciprocalSubconcept.label}
            // Reciprocal picks are gated on theirs < 0.55 in matching.ts,
            // so this is always a genuine weak spot of theirs.
            level="Weak"
          />
        ) : (
          <p className="pl-6 text-xs text-muted">
            No clean swap yet — you&apos;re mostly here to learn.
          </p>
        )}
      </div>

      {/* Schedule line. The matcher already merged contiguous overlap
          intervals, so we just need to format them prettily. */}
      {match.availabilityOverlap.length > 0 ? (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-muted">
          <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span>
            <span className="text-foreground">
              {formatOverlap(match.availabilityOverlap)}
            </span>{" "}
            free together
          </span>
        </p>
      ) : (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-muted/80">
          <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
          <span>No shared availability set</span>
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

function RankChip({ rank }: { rank: number }) {
  const label = rank === 1 ? "Top match" : `Stitch ${rank}`;
  // Top match gets the violet accent that matches the panel header chip;
  // 2 + 3 stay neutral so the visual hierarchy is unambiguous.
  const styles =
    rank === 1
      ? "border-violet-200 bg-violet-50 text-violet-800"
      : "border-border bg-white text-muted";
  return (
    <span
      className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles}`}
    >
      {label}
    </span>
  );
}

// One side of the swap. Direction picks the arrow (← incoming, → outgoing)
// and a soft tint so the two rows are visually distinct without being
// loud. The level pill on the right uses the same emerald/amber/rose
// palette as the ribbon, so "Strong" reads the same colour the student
// already associates with mastered cells.
type SwapLevel = "Strong" | "Mid" | "Weak";

function SwapRow({
  direction,
  who,
  topic,
  level,
}: {
  direction: "incoming" | "outgoing";
  who: string;
  topic: string;
  level: SwapLevel;
}) {
  const arrow = direction === "incoming" ? "←" : "→";
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono text-xs text-muted"
      >
        {arrow}
      </span>
      <span className="shrink-0 text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {who}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {topic}
      </span>
      <LevelPill level={level} />
    </div>
  );
}

function LevelPill({ level }: { level: SwapLevel }) {
  const styles: Record<SwapLevel, string> = {
    Strong: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Mid: "border-amber-200 bg-amber-50 text-amber-800",
    Weak: "border-rose-200 bg-rose-50 text-rose-800",
  };
  const dotStyles: Record<SwapLevel, string> = {
    Strong: "bg-emerald-500",
    Mid: "bg-amber-500",
    Weak: "bg-rose-500",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles[level]}`}
    >
      <span
        className={`inline-block h-1 w-1 rounded-full ${dotStyles[level]}`}
      />
      {level}
    </span>
  );
}

/** Mastery score → qualitative bucket using the ribbon's legend cutoffs
 *  (< 0.40 weak, 0.40–0.70 mid, > 0.70 strong). Keeps the language we
 *  show in the swap rows in lockstep with the colour scale on the ribbon
 *  itself. */
function bucketLabel(score: number): SwapLevel {
  if (score < 0.4) return "Weak";
  if (score <= 0.7) return "Mid";
  return "Strong";
}

// Form action — server creates the space + plan, then redirects the
// requester into /space/[id]. Plan generation can take 5-10s; the
// pending state covers that window.
function StartSpaceButton({
  courseId,
  partnerUserId,
  conceptId,
  subconceptId,
}: {
  courseId: string;
  partnerUserId: string;
  /** Forwarded to the server action so the session is scoped to the
   *  clicked cell instead of every pair-wide weak subconcept. */
  conceptId: string;
  subconceptId: string | null;
}) {
  return (
    <form action={startStitchSpaceForm} className="shrink-0">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="partnerUserId" value={partnerUserId} />
      <input type="hidden" name="conceptId" value={conceptId} />
      <input type="hidden" name="subconceptId" value={subconceptId ?? ""} />
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
      className="shrink-0 rounded-xl bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Building…" : "Start Stitch Space"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Compact human summary of overlap blocks. Caller has already merged
 *  contiguous intervals so we just need to list them. We show up to 2
 *  inline and roll the rest into "+N more" so a calendar-friendly match
 *  doesn't overflow the row.
 */
function formatOverlap(
  blocks: Array<{ day: string; start: string; end: string }>
): string {
  if (blocks.length === 0) return "";
  const visible = blocks
    .slice(0, 2)
    .map((b) => `${b.day} ${prettyTime(b.start)}–${prettyTime(b.end)}`);
  if (blocks.length > 2) visible.push(`+${blocks.length - 2} more`);
  return visible.join(", ");
}

/** "14:00" → "2 PM"; "14:30" → "2:30 PM". Drops the leading zero on
 *  hours and the ":00" on round hours so the chips stay compact. */
function prettyTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h24 = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
