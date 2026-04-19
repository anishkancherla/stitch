import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { TakeWeeklyQuiz } from "./TakeWeeklyQuiz";

type Params = { id: string; quizId: string };

interface StoredQuestion {
  subconceptId?: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
}

export default async function TakeWeeklyQuizPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id: courseId, quizId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: quiz } = await supabase
    .from("weekly_quizzes")
    .select("id, course_id, concept_id, questions_json")
    .eq("id", quizId)
    .single();
  if (!quiz || quiz.course_id !== courseId) notFound();

  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const { data: concept } = await supabase
    .from("concepts")
    .select("id, label")
    .eq("id", quiz.concept_id)
    .single();

  // If the student has already submitted, send them back to the list —
  // the list page shows their score there. The submit action also
  // refuses, but bouncing here avoids the user typing answers in vain.
  const { data: existingAttempt } = await supabase
    .from("weekly_quiz_attempts")
    .select("id")
    .eq("quiz_id", quizId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingAttempt) {
    redirect(`/student/courses/${courseId}/quizzes`);
  }

  const rawQuestions = Array.isArray(quiz.questions_json)
    ? (quiz.questions_json as StoredQuestion[])
    : [];

  // Strip `correctIndex` before sending to the client. The client only
  // needs prompt + choices to render; grading happens server-side.
  const clientQuestions = rawQuestions.map((q) => ({
    prompt: q.prompt,
    choices: q.choices,
  }));

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

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-12 pb-24">
        <Link
          href={`/student/courses/${course.id}/quizzes`}
          className="mb-6 inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          ← Back to quizzes
        </Link>

        <p className="text-xs uppercase tracking-[0.18em] text-muted">
          {course.code} · Weekly quiz
        </p>
        <h1 className="mt-2 font-inter text-3xl font-semibold tracking-tight text-foreground">
          {concept?.label ?? "Weekly quiz"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {clientQuestions.length} questions. Pass any subconcept&apos;s
          questions (≥ 60% correct on those) to bump that subconcept&apos;s
          mastery.
        </p>

        <div className="mt-8">
          <TakeWeeklyQuiz
            quizId={quiz.id}
            courseId={courseId}
            questions={clientQuestions}
          />
        </div>
      </main>
    </div>
  );
}
