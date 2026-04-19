import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";

type Params = { id: string };

// List of weekly quizzes for one course. Each row shows the concept,
// question count, and the student's status (not started / in progress
// is N/A here since we don't allow saving — either no row or done).
export default async function StudentCourseQuizzes({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name")
    .eq("id", id)
    .single();
  if (!course) notFound();

  // Pull concepts for this course so we can render rows even before the
  // prof has generated a quiz for them.
  const { data: concepts } = await supabase
    .from("concepts")
    .select("id, label, position_y")
    .eq("course_id", id)
    .order("position_y", { ascending: true })
    .order("label", { ascending: true });

  const conceptIds = (concepts ?? []).map((c) => c.id as string);

  const { data: quizzes } = conceptIds.length > 0
    ? await supabase
        .from("weekly_quizzes")
        .select("id, concept_id, questions_json, created_at")
        .in("concept_id", conceptIds)
    : { data: [] as Array<{ id: string; concept_id: string; questions_json: unknown; created_at: string }> };

  const quizByConcept = new Map<
    string,
    { id: string; questionCount: number; createdAt: string }
  >();
  for (const q of quizzes ?? []) {
    const arr = Array.isArray(q.questions_json) ? q.questions_json : [];
    quizByConcept.set(q.concept_id as string, {
      id: q.id as string,
      questionCount: arr.length,
      createdAt: q.created_at as string,
    });
  }

  const quizIds = Array.from(quizByConcept.values()).map((q) => q.id);
  const { data: myAttempts } = quizIds.length > 0
    ? await supabase
        .from("weekly_quiz_attempts")
        .select("quiz_id, score_pct, submitted_at")
        .eq("user_id", user.id)
        .in("quiz_id", quizIds)
    : { data: [] as Array<{ quiz_id: string; score_pct: number; submitted_at: string }> };

  const attemptByQuiz = new Map<string, { scorePct: number }>();
  for (const a of myAttempts ?? []) {
    attemptByQuiz.set(a.quiz_id as string, { scorePct: Number(a.score_pct) });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="rounded-xl border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
            >
              Profile
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-xl border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        }
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-12 pb-20">
        <Link
          href={`/student/courses/${course.id}`}
          className="mb-6 inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          ← Back to course
        </Link>

        <p className="text-xs uppercase tracking-[0.18em] text-muted">
          {course.code}
        </p>
        <h1 className="mt-2 font-inter text-3xl font-semibold tracking-tight text-foreground">
          Weekly quizzes
        </h1>
        <p className="mt-2 text-sm text-muted">
          One quiz per week. Each one bumps the mastery of every subconcept
          you score well on.
        </p>

        <div className="mt-8 flex flex-col gap-2">
          {(concepts ?? []).length === 0 && (
            <p className="text-sm text-muted">
              Your professor hasn&apos;t added any concepts yet.
            </p>
          )}
          {(concepts ?? []).map((c) => {
            const quiz = quizByConcept.get(c.id as string);
            const attempt = quiz ? attemptByQuiz.get(quiz.id) : undefined;
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{c.label}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {quiz
                      ? `${quiz.questionCount} questions`
                      : "Not generated yet"}
                    {attempt && (
                      <>
                        {" "}· You scored {Math.round(attempt.scorePct)}%
                      </>
                    )}
                  </p>
                </div>
                {quiz ? (
                  attempt ? (
                    <span className="rounded-lg border border-border bg-zinc-50 px-3 py-1.5 text-xs font-medium text-muted">
                      Submitted
                    </span>
                  ) : (
                    <Link
                      href={`/student/courses/${course.id}/quizzes/${quiz.id}`}
                      className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                    >
                      Take quiz
                    </Link>
                  )
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
