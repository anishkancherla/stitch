"use server";

// Professor-side weekly-quiz authoring. One action: generateWeeklyQuiz.
//
// Flow:
//   1. Auth + course-ownership check (the prof must own the concept's course).
//   2. Load every subconcept under the concept + its materials.
//   3. Compute per-subconcept question quota with the formula in the plan:
//        clamp(round(20 / N), 3, 6)
//      where N = subconcept count. Total ≈ 20 questions.
//   4. One Gemini call via WeeklyQuizGenerator.
//   5. Upsert into `weekly_quizzes` (unique on concept_id, so regenerate
//      cleanly replaces).
//
// Returned shape mirrors the other server actions: discriminated-union
// result so the caller (a client form) can branch on `ok`.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WeeklyQuizGenerator } from "@/lib/llm/WeeklyQuizGenerator";
import { quotaPerSubconcept } from "./weekly-quiz-utils";

export type GenerateWeeklyQuizResult =
  | { ok: true; quizId: string; questionCount: number }
  | { ok: false; error: string };

export async function generateWeeklyQuiz(
  conceptId: string,
): Promise<GenerateWeeklyQuizResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  const admin = createAdminClient();

  // Load concept + course (ownership check). Two-step to keep the
  // PostgREST embed unambiguous.
  const { data: concept, error: cErr } = await admin
    .from("concepts")
    .select("id, label, course_id")
    .eq("id", conceptId)
    .single();
  if (cErr || !concept) return { ok: false, error: "concept not found" };

  const { data: course, error: coErr } = await admin
    .from("courses")
    .select("id, code, name, professor_id")
    .eq("id", concept.course_id)
    .single();
  if (coErr || !course) return { ok: false, error: "course not found" };
  if (course.professor_id !== user.id) {
    return { ok: false, error: "you don't own this course" };
  }

  // All subconcepts under this concept, plus their materials.
  const { data: subs, error: sErr } = await admin
    .from("subconcepts")
    .select("id, label")
    .eq("concept_id", conceptId);
  if (sErr) return { ok: false, error: sErr.message };
  if (!subs || subs.length === 0) {
    return { ok: false, error: "no subconcepts under this concept yet" };
  }

  const subIds = subs.map((s) => s.id as string);
  const { data: matRows } = await admin
    .from("subconcept_materials")
    .select("subconcept_id, summary, key_points")
    .in("subconcept_id", subIds);
  const matsBySub = new Map<
    string,
    { summary: string; keyPoints: string[] }
  >();
  for (const m of matRows ?? []) {
    const kp = Array.isArray(m.key_points) ? (m.key_points as unknown[]) : [];
    matsBySub.set(m.subconcept_id as string, {
      summary: String(m.summary ?? "").trim(),
      keyPoints: kp.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0),
    });
  }

  const quota = quotaPerSubconcept(subs.length);
  const generatorInput = {
    courseLabel: `${course.code} ${course.name}`.trim(),
    conceptLabel: concept.label as string,
    subconcepts: subs.map((s) => {
      const mat = matsBySub.get(s.id as string);
      return {
        subconceptId: s.id as string,
        subconceptLabel: s.label as string,
        summary: mat?.summary,
        keyPoints: mat?.keyPoints,
        quota,
      };
    }),
  };

  let generated;
  try {
    generated = await new WeeklyQuizGenerator().generate(generatorInput);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "weekly quiz generation failed";
    return { ok: false, error: msg };
  }

  // Persist. Upsert on concept_id so "Regenerate" cleanly replaces the
  // existing quiz row (cascading attempt rows go with it via FK on
  // `quiz_id` — but we DON'T want to wipe attempts on regenerate; the
  // unique key is on concept_id which doesn't change, so we update the
  // SAME row instead of inserting a new one).
  const { data: upserted, error: upErr } = await admin
    .from("weekly_quizzes")
    .upsert(
      {
        course_id: course.id,
        concept_id: conceptId,
        questions_json: generated.questions,
        generated_by: user.id,
      },
      { onConflict: "concept_id" },
    )
    .select("id")
    .single();
  if (upErr || !upserted) {
    return { ok: false, error: upErr?.message ?? "failed to save quiz" };
  }

  // Course pages list weekly quizzes; revalidate both sides so the UI
  // reflects the new "Regenerate" state without a hard refresh.
  revalidatePath(`/professor/courses/${course.id}`, "page");
  revalidatePath(`/student/courses/${course.id}`, "page");
  revalidatePath(`/student/courses/${course.id}/quizzes`, "page");

  return {
    ok: true,
    quizId: upserted.id as string,
    questionCount: generated.questions.length,
  };
}

/** Form-action variant — wraps generateWeeklyQuiz for `<form action={...}>`
 *  use. Throws on failure so the form's error boundary surfaces it. */
export async function generateWeeklyQuizForm(formData: FormData): Promise<void> {
  const conceptId = String(formData.get("conceptId") ?? "").trim();
  if (!conceptId) throw new Error("missing conceptId");
  const res = await generateWeeklyQuiz(conceptId);
  if (!res.ok) {
    throw new Error(res.error);
  }
}
