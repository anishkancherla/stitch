import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { PublishButton } from "./PublishButton";
import { DeleteButton } from "./DeleteButton";

type Params = { id: string };

export default async function CourseDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name, status, join_code, created_at, professor_id")
    .eq("id", id)
    .single();

  // RLS would already block this, but the explicit check gives a clean 404.
  if (!course || course.professor_id !== user!.id) notFound();

  const { count: enrolledCount } = await supabase
    .from("enrollments")
    .select("*", { count: "exact", head: true })
    .eq("course_id", course.id);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
            >
              Profile
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        }
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-16 pb-16">
        <Link
          href="/professor"
          className="mb-4 text-sm text-muted hover:text-foreground"
        >
          ← Back to courses
        </Link>

        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl text-muted">
            {course.code}
          </span>
          <h1 className="font-display text-3xl tracking-tight text-foreground">
            {course.name}
          </h1>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {course.status === "published" && course.join_code ? (
            <div className="flex items-center gap-3 rounded-full border border-border bg-zinc-50 px-4 py-2">
              <span className="text-xs uppercase tracking-wider text-muted">
                Join code
              </span>
              <span className="font-mono text-base tracking-widest text-foreground">
                {course.join_code}
              </span>
            </div>
          ) : (
            <PublishButton courseId={course.id} />
          )}
          <DeleteButton courseId={course.id} />
        </div>

        <p className="mt-4 text-sm text-muted">
          {enrolledCount ?? 0}{" "}
          {enrolledCount === 1 ? "student enrolled" : "students enrolled"}
        </p>

        {/* Concepts editor / heatmap placeholder. Lands in the next batch. */}
        <section className="mt-12">
          <h2 className="text-base font-medium text-foreground">Concepts</h2>
          <div className="mt-3 rounded-2xl border border-border bg-zinc-50 px-5 py-12 text-center">
            <p className="text-sm text-muted">
              Concept and subconcept editor lands in the next batch.
            </p>
            <p className="mt-1 text-sm text-muted">
              Then the heatmap renders here for the class view.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
