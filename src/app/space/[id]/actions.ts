"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SpacesPlanner, PlannerWeakItem } from "@/lib/llm/SpacesPlanner";
import {
  expandPlan,
  gradeQuiz,
  MASTERY_BUMP_ON_PASS,
  PlannerStitch,
  requiredRespondents,
  SessionPlan,
  SessionStep,
  WEAK_THRESHOLD,
} from "@/lib/spaces";

// ---------------------------------------------------------------------------
// createStitchSpace — entry point invoked from MatchPanel.
//
// Steps:
//   1. Auth + enrollment guard (admin client used only for cross-user reads
//      that RLS would block).
//   2. Identify weak subconcepts for the pair (mastery < WEAK_THRESHOLD on
//      either student). At least one must exist.
//   3. Generate the SessionPlan via Gemini. ~5–10 s; the requester sits on
//      a loading state until this returns and we redirect.
//   4. Insert the row with plan_json, both members, and one card row per
//      (subconcept, weak target) pair.
//   5. Redirect requester to /space/[id]. Partner sees the room on their
//      dashboard "Open spaces" list.
// ---------------------------------------------------------------------------

export type CreateSpaceResult =
  | { ok: true; spaceId: string }
  | { ok: false; error: string };

export async function createStitchSpace(
  courseId: string,
  partnerUserId: string
): Promise<CreateSpaceResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };
  if (partnerUserId === user.id) {
    return { ok: false, error: "can't start a space with yourself" };
  }

  const admin = createAdminClient();

  // Both students must be enrolled in the course.
  const { data: enrollRows, error: enrollErr } = await admin
    .from("enrollments")
    .select("user_id")
    .eq("course_id", courseId)
    .in("user_id", [user.id, partnerUserId]);
  if (enrollErr) return { ok: false, error: enrollErr.message };
  if ((enrollRows ?? []).length !== 2) {
    return { ok: false, error: "both students must be enrolled in this course" };
  }

  // Pull every subconcept in the course + both students' mastery rows.
  const { data: subRows, error: subErr } = await admin
    .from("subconcepts")
    .select("id, label, concept_id, concepts!inner(label, course_id)")
    .eq("concepts.course_id", courseId);
  if (subErr) return { ok: false, error: subErr.message };
  const subconcepts = (subRows ?? []).map((r) => {
    // The nested join can be returned as object or array depending on the
    // codegen; coerce defensively.
    const conceptObj = Array.isArray(r.concepts) ? r.concepts[0] : r.concepts;
    return {
      id: r.id as string,
      label: r.label as string,
      conceptId: r.concept_id as string,
      conceptLabel:
        (conceptObj as { label?: string } | undefined)?.label ?? "Concept",
    };
  });
  if (subconcepts.length === 0) {
    return { ok: false, error: "no subconcepts in this course yet" };
  }
  const subIds = subconcepts.map((s) => s.id);

  const { data: masteryRows, error: mErr } = await admin
    .from("user_subconcept_mastery")
    .select("user_id, subconcept_id, score")
    .in("user_id", [user.id, partnerUserId])
    .in("subconcept_id", subIds);
  if (mErr) return { ok: false, error: mErr.message };

  const masteryByUser = new Map<string, Map<string, number>>([
    [user.id, new Map()],
    [partnerUserId, new Map()],
  ]);
  for (const row of masteryRows ?? []) {
    masteryByUser
      .get(row.user_id as string)
      ?.set(row.subconcept_id as string, row.score as number);
  }

  // Names for the plan + UI.
  const { data: nameRows, error: nameErr } = await admin
    .from("users")
    .select("id, name, email")
    .in("id", [user.id, partnerUserId]);
  if (nameErr) return { ok: false, error: nameErr.message };
  const nameById = new Map(
    (nameRows ?? []).map((u) => [
      u.id as string,
      ((u.name as string) || "").trim() || (u.email as string) || "Student",
    ])
  );

  // Identify weak subconcepts. A subconcept is "weak" if EITHER student has
  // mastery < WEAK_THRESHOLD on it. The planner decides per-stitch who
  // teaches (if exactly one is weak) vs LLM-teach (if both are).
  const weakItems: PlannerWeakItem[] = [];
  for (const s of subconcepts) {
    const mineRaw = masteryByUser.get(user.id)!.get(s.id);
    const theirsRaw = masteryByUser.get(partnerUserId)!.get(s.id);
    const mine = mineRaw ?? 0.5;
    const theirs = theirsRaw ?? 0.5;
    if (mine < WEAK_THRESHOLD || theirs < WEAK_THRESHOLD) {
      weakItems.push({
        subconceptId: s.id,
        subconceptLabel: s.label,
        conceptLabel: s.conceptLabel,
        masteryByUser: { [user.id]: mine, [partnerUserId]: theirs },
      });
    }
  }
  if (weakItems.length === 0) {
    return {
      ok: false,
      error: "no weak subconcepts between you two — nothing to study",
    };
  }

  // Cap to keep plan generation fast and the session short. 6 stitches ≈
  // 12 steps ≈ a 30–45 minute session.
  const MAX_STITCHES = 6;
  const trimmed = weakItems.slice(0, MAX_STITCHES);

  const members = [
    { userId: user.id, name: nameById.get(user.id) ?? "You" },
    { userId: partnerUserId, name: nameById.get(partnerUserId) ?? "Partner" },
  ];

  // Plan generation — one Gemini call. Bubble up the message instead of
  // crashing the route so the UI can show a retry button.
  let stitches: PlannerStitch[];
  try {
    const planner = new SpacesPlanner();
    const out = await planner.plan({
      members,
      weakItems: trimmed,
      weakThreshold: WEAK_THRESHOLD,
    });
    stitches = out.stitches;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "plan generation failed";
    return { ok: false, error: msg };
  }

  const meta = new Map(
    subconcepts.map((s) => [
      s.id,
      { conceptLabel: s.conceptLabel, subconceptLabel: s.label },
    ])
  );
  const steps: SessionStep[] = expandPlan(stitches, meta);
  if (steps.length === 0) {
    return { ok: false, error: "planner returned no usable steps" };
  }

  const plan: SessionPlan = { version: 1, members, steps };

  // Insert space + member rows + initial card rows. Admin client because
  // the requester isn't a "member" yet at insert time — they'll be after
  // these rows commit. Doing it via admin is the simplest correct ordering.
  const { data: insertedSpace, error: spaceErr } = await admin
    .from("stitch_spaces")
    .insert({
      course_id: courseId,
      created_by: user.id,
      status: "active",
      plan_json: plan,
      current_step: 0,
    })
    .select("id")
    .single();
  if (spaceErr || !insertedSpace) {
    return { ok: false, error: spaceErr?.message ?? "failed to create space" };
  }
  const spaceId = insertedSpace.id as string;

  const { error: memberErr } = await admin.from("stitch_space_members").insert([
    { space_id: spaceId, user_id: user.id },
    { space_id: spaceId, user_id: partnerUserId },
  ]);
  if (memberErr) return { ok: false, error: memberErr.message };

  // Card rows: one per (subconcept, target_user). Target is whoever was
  // weak on that subconcept — the spec is explicit that "Both: weak"
  // produces two cards because each student must independently prove.
  const cardRows: Array<{
    space_id: string;
    subconcept_id: string;
    target_user_id: string;
  }> = [];
  for (const w of trimmed) {
    for (const m of members) {
      if ((w.masteryByUser[m.userId] ?? 0.5) < WEAK_THRESHOLD) {
        cardRows.push({
          space_id: spaceId,
          subconcept_id: w.subconceptId,
          target_user_id: m.userId,
        });
      }
    }
  }
  if (cardRows.length > 0) {
    const { error: cardsErr } = await admin
      .from("stitch_space_cards")
      .insert(cardRows);
    if (cardsErr) return { ok: false, error: cardsErr.message };
  }

  return { ok: true, spaceId };
}

/** Form-action variant — same as createStitchSpace but takes FormData and
 *  redirects on success. Used by the "Start Stitch Space" button in
 *  MatchPanel. Throws an Error on failure so the form's error boundary
 *  surfaces it (no inline error UI yet). */
export async function startStitchSpaceForm(formData: FormData): Promise<void> {
  const courseId = String(formData.get("courseId") ?? "");
  const partnerUserId = String(formData.get("partnerUserId") ?? "");
  if (!courseId || !partnerUserId) {
    throw new Error("missing courseId or partnerUserId");
  }
  const res = await createStitchSpace(courseId, partnerUserId);
  if (!res.ok) {
    // redirect with an error param so the dashboard can show a toast.
    redirect(`/student?spaceError=${encodeURIComponent(res.error)}`);
  }
  redirect(`/space/${res.spaceId}`);
}

// ---------------------------------------------------------------------------
// submitStepResponse — unified per-step write. The room calls this for
// every step type:
//
//   teach       payload: { kind: "done" }
//   llm_teach   payload: { kind: "done" }
//   quiz        payload: { kind: "quiz", answers: number[] }
//
// On a quiz, we grade server-side, write mastery + flip the card if the
// target passed, and (only when ALL required respondents are in) advance
// the room's current_step. Realtime subscribers see all of this.
// ---------------------------------------------------------------------------

export type SubmitStepResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitStepResponse(
  spaceId: string,
  stepIdx: number,
  payload:
    | { kind: "done" }
    | { kind: "quiz"; answers: number[] }
): Promise<SubmitStepResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (!user) {
    // Diagnostic: log how the action received the request when auth
    // dropped out. Most useful field is whether any sb-* cookie was
    // present at all — narrows browser-cookie-eviction vs server-side
    // cookie-stripping bugs.
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const sbCookies = jar
      .getAll()
      .filter((c) => c.name.startsWith("sb-"))
      .map((c) => c.name);
    console.warn("[submitStepResponse] no user. spaceId=%s stepIdx=%s cookies=%o err=%o", spaceId, stepIdx, sbCookies, userErr?.message);
    return { ok: false, error: "not signed in" };
  }

  const admin = createAdminClient();

  // Load the space state. Admin used so we don't have to round-trip
  // through RLS for the membership check.
  const { data: spaceRow, error: spaceErr } = await admin
    .from("stitch_spaces")
    .select("id, status, current_step, plan_json")
    .eq("id", spaceId)
    .single();
  if (spaceErr || !spaceRow) {
    return { ok: false, error: "space not found" };
  }
  if (spaceRow.status !== "active") {
    return { ok: false, error: "space is not active" };
  }
  if (spaceRow.current_step !== stepIdx) {
    // Stale submission — UI raced ahead/behind. Idempotent: just no-op.
    return { ok: true };
  }

  const plan = spaceRow.plan_json as SessionPlan;
  const step = plan.steps[stepIdx];
  if (!step) return { ok: false, error: "invalid step" };

  // Membership guard — the user must be a member of the room.
  const { data: memberRows, error: mErr } = await admin
    .from("stitch_space_members")
    .select("user_id")
    .eq("space_id", spaceId);
  if (mErr) return { ok: false, error: mErr.message };
  const memberIds = (memberRows ?? []).map((r) => r.user_id as string);
  if (!memberIds.includes(user.id)) {
    return { ok: false, error: "not a member of this space" };
  }

  const required = requiredRespondents(step, memberIds);
  if (!required.includes(user.id)) {
    // Submission from a user who isn't expected to act on this step (e.g.
    // the learner pressing Done during a teach step). Accept silently —
    // their response is just stored for record but doesn't gate advance.
  }

  // Persist the submission. Unique on (space_id, step_idx, user_id) so a
  // double-submit returns a constraint error we treat as already-recorded.
  const { error: respErr } = await admin
    .from("stitch_space_responses")
    .insert({
      space_id: spaceId,
      step_idx: stepIdx,
      user_id: user.id,
      payload_json: payload,
    });
  if (respErr && !isUniqueViolation(respErr)) {
    return { ok: false, error: respErr.message };
  }

  // ---- Per-type side-effects ---------------------------------------------

  if (step.type === "quiz" && payload.kind === "quiz") {
    if (step.targetUserIds.includes(user.id)) {
      const grade = gradeQuiz(step, payload.answers);
      if (grade.passed) {
        // 1) Bump mastery for the target student on this subconcept.
        const { data: prior } = await admin
          .from("user_subconcept_mastery")
          .select("score")
          .eq("user_id", user.id)
          .eq("subconcept_id", step.subconceptId)
          .maybeSingle();
        const currentScore = prior?.score ?? 0.5;
        const nextScore = Math.min(1, currentScore + MASTERY_BUMP_ON_PASS);
        await admin
          .from("user_subconcept_mastery")
          .upsert(
            {
              user_id: user.id,
              subconcept_id: step.subconceptId,
              score: nextScore,
              last_updated: new Date().toISOString(),
            },
            { onConflict: "user_id,subconcept_id" }
          );

        // 2) Mastery event log. 'manual' is the closest existing enum
        //    value (see migration 0007 header comment for the rationale).
        await admin.from("mastery_events").insert({
          user_id: user.id,
          subconcept_id: step.subconceptId,
          score: nextScore,
          source: "manual",
        });

        // 3) Flip the card to green for this user on this subconcept.
        await admin
          .from("stitch_space_cards")
          .update({ status: "green", updated_at: new Date().toISOString() })
          .eq("space_id", spaceId)
          .eq("subconcept_id", step.subconceptId)
          .eq("target_user_id", user.id);
      } else {
        // Mark the card as attempted so the board reflects the try.
        await admin
          .from("stitch_space_cards")
          .update({ status: "attempted", updated_at: new Date().toISOString() })
          .eq("space_id", spaceId)
          .eq("subconcept_id", step.subconceptId)
          .eq("target_user_id", user.id);
      }
    }
  }

  // ---- Advance if every required respondent is in ------------------------

  const { data: respRows, error: rErr } = await admin
    .from("stitch_space_responses")
    .select("user_id")
    .eq("space_id", spaceId)
    .eq("step_idx", stepIdx);
  if (rErr) return { ok: false, error: rErr.message };
  const submittedUserIds = new Set(
    (respRows ?? []).map((r) => r.user_id as string)
  );
  const ready = required.every((u) => submittedUserIds.has(u));

  if (ready) {
    const nextIdx = stepIdx + 1;
    if (nextIdx >= plan.steps.length) {
      // Session over.
      await admin
        .from("stitch_spaces")
        .update({
          status: "ended",
          current_step: nextIdx,
          ended_at: new Date().toISOString(),
        })
        .eq("id", spaceId);
    } else {
      await admin
        .from("stitch_spaces")
        .update({ current_step: nextIdx })
        .eq("id", spaceId);
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// endStitchSpace — manual end (the "End session" button).
// ---------------------------------------------------------------------------

export async function endStitchSpace(spaceId: string): Promise<SubmitStepResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  const admin = createAdminClient();
  const { data: memberRow } = await admin
    .from("stitch_space_members")
    .select("user_id")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!memberRow) return { ok: false, error: "not a member" };

  await admin
    .from("stitch_spaces")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", spaceId);
  revalidatePath(`/space/${spaceId}`, "page");
  return { ok: true };
}

function isUniqueViolation(err: { code?: string }): boolean {
  return err?.code === "23505";
}
