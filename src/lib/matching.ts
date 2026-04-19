// Contextual matching algorithm. Pure — no DB, no React. The server action
// in src/app/student/courses/[id]/actions.ts does the privileged data fetch
// and feeds shaped inputs into rankMatches() below.
//
// Per Stitch contextual-matching pivot:
//   For a clicked concept (and optionally a specific subconcept), rank
//   classmates so that the top of the list is "most useful peer to study
//   with right now" — primarily someone strong where the requester is weak,
//   secondarily someone the requester can teach back on a different
//   subconcept (mutual benefit).
//
// Availability overlap is on the spec (slice 2) — left as a stub here so
// the call signature won't change when it lands.

export type SubconceptMeta = {
  id: string;
  label: string;
  conceptId: string;
};

/** Half-open weekly free block. Times are minutes-since-midnight (0..1440)
 *  to keep intersection math integer-clean. */
export type AvailabilityBlock = {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
};

export type ClassmateInput = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  /** subconceptId -> mastery score in [0,1]. Missing entries default to 0.5
   *  (the trigger seeds 0.5 on enrollment, so this is a safe fallback). */
  mastery: Map<string, number>;
  /** Their weekly free blocks. Empty array = no availability set, in which
   *  case the overlap term contributes 0 (matching still works on mastery
   *  alone — they just won't get the availability boost). */
  availability?: AvailabilityBlock[];
};

export type MatchResult = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Their mastery on the focused concept/subconcept (0..1). */
  theirMastery: number;
  /** Requester's mastery on the focused concept/subconcept (0..1). */
  myMastery: number;
  /** One subconcept the requester is strong in and they're weak in.
   *  Null when no useful reciprocal exists (their ribbon is at-or-above
   *  the requester everywhere). Drives the "you can help them with X"
   *  hook in the UI. */
  reciprocalSubconcept: { id: string; label: string } | null;
  /** Concrete shared free blocks (clipped to the intersection of both
   *  students' availability). Empty when neither has set availability or
   *  there's no overlap. */
  availabilityOverlap: Array<{ day: string; start: string; end: string }>;
  /** Total overlap hours per week — what feeds the score's third term. */
  overlapHours: number;
  /** Composite ranking score; higher = better match. Surfaced for debug,
   *  not necessarily shown in the UI. */
  score: number;
};

export interface RankMatchesArgs {
  /** subconceptId -> requester's mastery score. */
  myMastery: Map<string, number>;
  /** Requester's own free blocks. Empty = matching falls back to mastery
   *  only (no overlap term contributed by anyone). */
  myAvailability?: AvailabilityBlock[];
  /** Other students in the same course. The caller has already filtered
   *  out the requester themselves. */
  classmates: ClassmateInput[];
  /** All subconcepts in the course, keyed for label lookups + the
   *  per-concept aggregate when no specific subconcept is focused. */
  subconcepts: SubconceptMeta[];
  /** The clicked concept. */
  conceptId: string;
  /** If set, rank by this specific subconcept's mastery delta instead of
   *  the concept aggregate. */
  subconceptId?: string | null;
  /** How many to return. Defaults to 5 per the spec. */
  limit?: number;
}

const DEFAULT_MASTERY = 0.5;

// How heavily we weight the reciprocal half. The primary direction (they
// teach me) wins, but having something to give back nudges them up.
const RECIPROCAL_WEIGHT = 0.5;

// Floors for the reciprocal pick — we don't want to suggest "you can teach
// them X" if the requester is barely above 0.5 on X. Tuned conservatively;
// loosen if matches dry up at small N.
const MIN_MY_STRENGTH_FOR_RECIPROCAL = 0.6;
const MAX_THEIR_WEAKNESS_FOR_RECIPROCAL = 0.55;

// Availability term weight. The spec writes the score as raw "+ overlap
// hours", but raw hours dwarf mastery deltas (which top out near 1.0). We
// normalise by dividing — 1 hour of overlap ≈ 0.1 score points, so a
// classmate with 5 shared hours edges out one with 0 by half a mastery
// gap. Tweak if matching feels too availability-heavy.
const OVERLAP_HOURS_WEIGHT = 0.1;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function rankMatches(args: RankMatchesArgs): MatchResult[] {
  const {
    myMastery,
    myAvailability = [],
    classmates,
    subconcepts,
    conceptId,
    subconceptId,
    limit = 5,
  } = args;

  // Build a quick lookup: which subconcepts belong to the focused concept.
  // Used for the aggregate path when no specific subconcept is given.
  const conceptSubIds = subconcepts
    .filter((s) => s.conceptId === conceptId)
    .map((s) => s.id);
  if (conceptSubIds.length === 0) return [];

  const subById = new Map(subconcepts.map((s) => [s.id, s]));

  const myFocusMastery = focusMastery(
    myMastery,
    subconceptId ?? null,
    conceptSubIds
  );

  const out: MatchResult[] = [];
  for (const cm of classmates) {
    const theirFocus = focusMastery(
      cm.mastery,
      subconceptId ?? null,
      conceptSubIds
    );

    // Primary teach-me term — clamped to >=0 so peers who are weaker than
    // me on this concept don't *help* their score, they just don't hurt it.
    const teachMe = Math.max(0, theirFocus - myFocusMastery);

    // Reciprocal pick — pure scan over all subconcepts. The set is small
    // (tens), so an O(N*M) double-loop here is fine.
    let reciprocal: MatchResult["reciprocalSubconcept"] = null;
    let teachThem = 0;
    for (const s of subconcepts) {
      const mine = myMastery.get(s.id) ?? DEFAULT_MASTERY;
      const theirs = cm.mastery.get(s.id) ?? DEFAULT_MASTERY;
      if (mine < MIN_MY_STRENGTH_FOR_RECIPROCAL) continue;
      if (theirs > MAX_THEIR_WEAKNESS_FOR_RECIPROCAL) continue;
      const gap = mine - theirs;
      if (gap > teachThem) {
        teachThem = gap;
        reciprocal = { id: s.id, label: s.label };
      }
    }

    // Availability term — only contributes when both sides have set blocks.
    // Empty on either side ⇒ zero, so unset students aren't penalised
    // beyond losing the boost.
    const overlapBlocks = intersectAvailability(myAvailability, cm.availability ?? []);
    const overlapMinutes = overlapBlocks.reduce(
      (n, b) => n + (b.endMinutes - b.startMinutes),
      0
    );
    const overlapHours = overlapMinutes / 60;

    const score =
      teachMe +
      RECIPROCAL_WEIGHT * teachThem +
      OVERLAP_HOURS_WEIGHT * overlapHours;

    out.push({
      userId: cm.userId,
      name: cm.name,
      avatarUrl: cm.avatarUrl ?? null,
      theirMastery: round2(theirFocus),
      myMastery: round2(myFocusMastery),
      reciprocalSubconcept: reciprocal,
      availabilityOverlap: overlapBlocks.map((b) => ({
        day: DAY_LABELS[b.dayOfWeek],
        start: minutesToHHMM(b.startMinutes),
        end: minutesToHHMM(b.endMinutes),
      })),
      overlapHours: round2(overlapHours),
      score: round2(score),
    });
  }

  // Drop matches with zero teach-me potential (they're not actually a
  // useful study partner for *this* concept). If we'd lose everyone, fall
  // back to the unfiltered list so the UI never silently empties.
  const filtered = out.filter((m) => m.theirMastery > m.myMastery);
  const pool = filtered.length > 0 ? filtered : out;

  pool.sort((a, b) => b.score - a.score);
  return pool.slice(0, limit);

  // Unused but kept around: subById is handy if we ever want to render
  // the focused subconcept's *label* server-side. Quiet the linter.
  void subById;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function focusMastery(
  mastery: Map<string, number>,
  subconceptId: string | null,
  conceptSubIds: string[]
): number {
  if (subconceptId) {
    return mastery.get(subconceptId) ?? DEFAULT_MASTERY;
  }
  let sum = 0;
  for (const sid of conceptSubIds) sum += mastery.get(sid) ?? DEFAULT_MASTERY;
  return sum / conceptSubIds.length;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Availability intersection. Both inputs are arrays of weekly free blocks;
// output is the set of blocks where both students are simultaneously free,
// merged across overlapping/adjacent intervals on each day so the UI sees
// the cleanest possible chips.
// ---------------------------------------------------------------------------

export function intersectAvailability(
  a: AvailabilityBlock[],
  b: AvailabilityBlock[]
): AvailabilityBlock[] {
  if (a.length === 0 || b.length === 0) return [];

  const out: AvailabilityBlock[] = [];
  for (let day = 0; day < 7; day++) {
    const aDay = a.filter((x) => x.dayOfWeek === day);
    const bDay = b.filter((x) => x.dayOfWeek === day);
    if (aDay.length === 0 || bDay.length === 0) continue;
    for (const x of aDay) {
      for (const y of bDay) {
        const start = Math.max(x.startMinutes, y.startMinutes);
        const end = Math.min(x.endMinutes, y.endMinutes);
        if (end > start) out.push({ dayOfWeek: day, startMinutes: start, endMinutes: end });
      }
    }
  }

  // Merge touching/overlapping per day so UI sees one chip per contiguous
  // block, not several abutting ones.
  out.sort((p, q) =>
    p.dayOfWeek - q.dayOfWeek || p.startMinutes - q.startMinutes
  );
  const merged: AvailabilityBlock[] = [];
  for (const blk of out) {
    const last = merged[merged.length - 1];
    if (last && last.dayOfWeek === blk.dayOfWeek && last.endMinutes >= blk.startMinutes) {
      last.endMinutes = Math.max(last.endMinutes, blk.endMinutes);
    } else {
      merged.push({ ...blk });
    }
  }
  return merged;
}

// Helper for callers loading rows from `user_availability` — turns the
// "HH:MM:SS" strings into the integer-minute form rankMatches expects.
export function dbBlockToBlock(row: {
  day_of_week: number;
  start_time: string;
  end_time: string;
}): AvailabilityBlock {
  return {
    dayOfWeek: row.day_of_week,
    startMinutes: hhmmToMinutes(row.start_time),
    endMinutes: hhmmToMinutes(row.end_time),
  };
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}
