import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";

type Params = { id: string };

export default async function StudentCourseDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS gates this read on is_enrolled(id), so a non-enrolled student
  // gets back nothing → 404.
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, name")
    .eq("id", id)
    .single();

  if (!course) notFound();

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
          href="/student"
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

        <section className="mt-12">
          <h2 className="text-base font-medium text-foreground">
            Your mastery
          </h2>
          <div className="mt-3 rounded-2xl border border-border bg-zinc-50 px-5 py-12 text-center">
            <p className="text-sm text-muted">
              Your personal heatmap lands in the next batch.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
