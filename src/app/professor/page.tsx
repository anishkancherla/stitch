import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";

export default async function ProfessorHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", user!.id)
    .single();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
            >
              Sign out
            </button>
          </form>
        }
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-20">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">
          Professor
        </p>
        <h1 className="mt-1 font-display text-4xl tracking-tight text-foreground">
          {profile?.name || profile?.email}
        </h1>

        <section className="mt-12">
          <h2 className="text-base font-medium text-foreground">
            Your courses
          </h2>
          <div className="mt-3 rounded-2xl border border-border bg-zinc-50 px-5 py-10 text-center">
            <p className="text-sm text-muted">
              You haven&apos;t created any courses yet.
            </p>
            <p className="mt-1 text-sm text-muted">
              Course creation arrives in Phase 1.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
