"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  rankMatches,
  focusMastery,
  dbBlockToBlock,
  STRONG_FOCUS_THRESHOLD,
  type AvailabilityBlock,
  type MatchResult,
} from "@/lib/matching";

/** Demo helper. Bump the current student's mastery on one subconcept up or down.
 *  Stores a clamped score in [0, 1]. Logs nothing — this is for demoing only. */
export async function bumpMastery(
  courseId: string,
  subconceptId: string,
  delta: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: row } = await supabase
    .from("user_subconcept_mastery")
    .select("score")
    .eq("user_id", user.id)
    .eq("subconcept_id", subconceptId)
    .single();

  const current = row?.score ?? 0.5;
  const next = Math.max(0, Math.min(1, current + delta));

  await supabase
    .from("user_subconcept_mastery")
    .upsert(
      {
        user_id: user.id,
        subconcept_id: subconceptId,
        score: next,
        last_updated: new Date().toISOString(),
      },
      { onConflict: "user_id,subconcept_id" }
    );

  revalidatePath(`/student/courses/${courseId}`, "page");
  return { ok: true, score: next };
}

// ---------------------------------------------------------------------------
// Contextual matching — fetch top-N classmates for the focused concept
// (or specific subconcept). Uses the admin client because we need to read
// other students' mastery + names, which RLS deliberately blocks. We still
// gate on the requester being enrolled in the course so this can't be used
// to scrape a class the caller doesn't belong to.
// ---------------------------------------------------------------------------

export type GetMatchesResult =
  | {
      ok: true;
      matches: MatchResult[];
      /** Requester's mastery on the focused cell (subconcept score, or
       *  concept aggregate when no subconcept is selected). The UI uses
       *  this to flip the panel into a "you're already strong" state
       *  when matching wouldn't be useful. */
      myFocusMastery: number;
      /** Mirrors `myFocusMastery > STRONG_FOCUS_THRESHOLD`. Surfaced as
       *  a flag so the UI doesn't have to know the threshold. */
      alreadyStrong: boolean;
    }
  | { ok: false; error: string };

export async function getMatchesForConcept(
  courseId: string,
  conceptId: string,
  subconceptId: string | null = null,
  limit: number = 3
): Promise<GetMatchesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  // Enrollment guard via the user-scoped client. RLS makes this read return
  // a row only when the caller is actually enrolled.
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!enrollment) return { ok: false, error: "not enrolled" };

  const admin = createAdminClient();

  // Fetch all subconcepts in the course (with their concept_id) — the
  // matching algorithm needs the full set to compute reciprocals across
  // concepts the requester didn't click.
  const { data: subRows, error: subErr } = await admin
    .from("subconcepts")
    .select("id, label, concept_id, concepts!inner(course_id)")
    .eq("concepts.course_id", courseId);
  if (subErr || !subRows) {
    return { ok: false, error: subErr?.message ?? "failed to load subconcepts" };
  }
  const subconcepts = subRows.map((s) => ({
    id: s.id as string,
    label: s.label as string,
    conceptId: s.concept_id as string,
  }));
  const subIds = subconcepts.map((s) => s.id);
  if (subIds.length === 0) {
    return { ok: true, matches: [], myFocusMastery: 0, alreadyStrong: false };
  }

  // All enrolled classmates (excluding the requester).
  const { data: enrollRows, error: eErr } = await admin
    .from("enrollments")
    .select("user_id")
    .eq("course_id", courseId)
    .neq("user_id", user.id);
  if (eErr) return { ok: false, error: eErr.message };
  const classmateIds = (enrollRows ?? []).map((r) => r.user_id as string);
  if (classmateIds.length === 0) {
    return { ok: true, matches: [], myFocusMastery: 0, alreadyStrong: false };
  }

  // Pull mastery for everyone in one shot — requester + classmates, scoped
  // to this course's subconcepts.
  const { data: masteryRows, error: mErr } = await admin
    .from("user_subconcept_mastery")
    .select("user_id, subconcept_id, score")
    .in("user_id", [user.id, ...classmateIds])
    .in("subconcept_id", subIds);
  if (mErr) return { ok: false, error: mErr.message };

  // Names for the classmates — public.users is RLS-locked to self, so we
  // need admin here too. Avatar columns aren't in the schema yet, so the
  // result type carries null and the UI falls back to a monogram.
  const { data: nameRows, error: nErr } = await admin
    .from("users")
    .select("id, name, email")
    .in("id", classmateIds);
  if (nErr) return { ok: false, error: nErr.message };

  const nameById = new Map(
    (nameRows ?? []).map((u) => [
      u.id as string,
      (u.name as string)?.trim() || (u.email as string) || "Classmate",
    ])
  );

  // Bucket mastery rows by user.
  const myMastery = new Map<string, number>();
  const classmatesMap = new Map<string, Map<string, number>>();
  for (const cid of classmateIds) classmatesMap.set(cid, new Map());
  for (const row of masteryRows ?? []) {
    const uid = row.user_id as string;
    const sid = row.subconcept_id as string;
    const score = row.score as number;
    if (uid === user.id) myMastery.set(sid, score);
    else classmatesMap.get(uid)?.set(sid, score);
  }

  // Compute the requester's mastery on the focused cell first. If they're
  // already strong here, matching is the wrong tool — short-circuit before
  // we burn cycles fetching availability + ranking. The UI uses the
  // `alreadyStrong` flag to flip into a different empty state.
  const conceptSubIds = subconcepts
    .filter((s) => s.conceptId === conceptId)
    .map((s) => s.id);
  const myFocusMastery = focusMastery(myMastery, subconceptId, conceptSubIds);
  if (myFocusMastery > STRONG_FOCUS_THRESHOLD) {
    return { ok: true, matches: [], myFocusMastery, alreadyStrong: true };
  }

  // Availability for everyone (requester + classmates) in a single pass.
  // RLS allows cross-read because all parties share at least this course.
  const { data: availRows, error: aErr } = await admin
    .from("user_availability")
    .select("user_id, day_of_week, start_time, end_time")
    .in("user_id", [user.id, ...classmateIds]);
  if (aErr) return { ok: false, error: aErr.message };

  const availByUser = new Map<string, AvailabilityBlock[]>();
  for (const row of availRows ?? []) {
    const uid = row.user_id as string;
    const block = dbBlockToBlock({
      day_of_week: row.day_of_week as number,
      start_time: row.start_time as string,
      end_time: row.end_time as string,
    });
    if (!availByUser.has(uid)) availByUser.set(uid, []);
    availByUser.get(uid)!.push(block);
  }
  const myAvailability = availByUser.get(user.id) ?? [];

  const classmates = classmateIds.map((cid) => ({
    userId: cid,
    name: nameById.get(cid) ?? "Classmate",
    avatarUrl: null,
    mastery: classmatesMap.get(cid) ?? new Map<string, number>(),
    availability: availByUser.get(cid) ?? [],
  }));

  const matches = rankMatches({
    myMastery,
    myAvailability,
    classmates,
    subconcepts,
    conceptId,
    subconceptId,
    limit,
  });

  return { ok: true, matches, myFocusMastery, alreadyStrong: false };
}
