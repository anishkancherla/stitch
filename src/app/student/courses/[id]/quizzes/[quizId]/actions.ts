"use server";

// Student-side: submit a weekly quiz attempt.
//
// Server-grades against the canonical correct_index, persists one
// attempt row, then per-subconcept bumps mastery for any subconcept
// where the student got >= QUIZ_PASS_FRACTION of its questions right.
// Each bump also writes a mastery_events row so the ribbon's history
// stays explainable.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MASTERY_BUMP_ON_PASS,
  QUIZ_PASS_FRACTION,
} from "@/lib/spaces";

interface StoredQuestion {
  subconceptId?: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export type SubmitWeeklyQuizResult =
  | {
      ok: true;
      scorePct: number;
      perSubconcept: Array<{
        subconceptId: string;
        correct: number;
        total: number;
        passed: boolean;
        nextScore: number | null;
      }>;
    }
  | { ok: false; error: string };

export async function submitWeeklyQuiz(
  quizId: string,
  answers: number[],
): Promise<SubmitWeeklyQuizResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  const admin = createAdminClient();

  const { data: quiz, error: qErr } = await admin
    .from("weekly_quizzes")
    .select("id, course_id, concept_id, questions_json")
    .eq("id", quizId)
    .single();
  if (qErr || !quiz) return { ok: false, error: "quiz not found" };

  // Block re-takes. The unique (quiz_id, user_id) constraint would also
  // catch this, but checking up-front gives a clean error message and
  // prevents wasted Gemini grading work.
  const { data: existing } = await admin
    .from("weekly_quiz_attempts")
    .select("id")
    .eq("quiz_id", quizId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return { ok: false, error: "you've already taken this quiz" };

  const questions = Array.isArray(quiz.questions_json)
    ? (quiz.questions_json as StoredQuestion[])
    : [];
  if (questions.length === 0) {
    return { ok: false, error: "this quiz has no questions" };
  }
  if (answers.length !== questions.length) {
    return {
      ok: false,
      error: `expected ${questions.length} answers, got ${answers.length}`,
    };
  }

  // Per-subconcept tally so we can bump mastery surgically.
  type Tally = { correct: number; total: number };
  const tallies = new Map<string, Tally>();
  let totalCorrect = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const ans = answers[i];
    const right = ans === q.correctIndex;
    if (right) totalCorrect += 1;
    const sid = q.subconceptId;
    if (!sid) continue;
    const t = tallies.get(sid) ?? { correct: 0, total: 0 };
    t.total += 1;
    if (right) t.correct += 1;
    tallies.set(sid, t);
  }
  const scorePct = (totalCorrect / questions.length) * 100;

  // Insert the attempt FIRST so a partial mastery-bump failure doesn't
  // leave the student locked out of re-taking with no record.
  const { error: insErr } = await admin
    .from("weekly_quiz_attempts")
    .insert({
      quiz_id: quizId,
      user_id: user.id,
      answers_json: answers,
      score_pct: scorePct,
    });
  if (insErr) return { ok: false, error: insErr.message };

  // Per-subconcept mastery bumps. Reuse the same 0.3 bump and 0.6 pass
  // threshold as Stitch Spaces so the two systems award mastery on
  // consistent terms.
  const perSubconcept: Extract<SubmitWeeklyQuizResult, { ok: true }>["perSubconcept"] = [];
  for (const [sid, t] of tallies) {
    const passed = t.total > 0 && t.correct / t.total >= QUIZ_PASS_FRACTION;
    let nextScore: number | null = null;
    if (passed) {
      const { data: prior } = await admin
        .from("user_subconcept_mastery")
        .select("score")
        .eq("user_id", user.id)
        .eq("subconcept_id", sid)
        .maybeSingle();
      const currentScore = prior?.score ?? 0.5;
      nextScore = Math.min(1, currentScore + MASTERY_BUMP_ON_PASS);
      await admin
        .from("user_subconcept_mastery")
        .upsert(
          {
            user_id: user.id,
            subconcept_id: sid,
            score: nextScore,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,subconcept_id" },
        );
      await admin.from("mastery_events").insert({
        user_id: user.id,
        subconcept_id: sid,
        score: nextScore,
        source: "manual",
      });
    }
    perSubconcept.push({
      subconceptId: sid,
      correct: t.correct,
      total: t.total,
      passed,
      nextScore,
    });
  }

  // Refresh the student's course view (mastery numbers shifted) and the
  // quiz list (the row should flip to "Submitted").
  revalidatePath(`/student/courses/${quiz.course_id}`, "page");
  revalidatePath(`/student/courses/${quiz.course_id}/quizzes`, "page");

  return { ok: true, scorePct, perSubconcept };
}
