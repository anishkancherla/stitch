import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../(auth)/actions";
import { ProfileForm } from "./ProfileForm";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("users")
    .select("name, email, role, created_at")
    .eq("id", user!.id)
    .single();

  const home = profile?.role === "professor" ? "/professor" : "/student";

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

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-16">
        <Link
          href={home}
          className="mb-4 text-sm text-muted hover:text-foreground"
        >
          ← Back
        </Link>

        <p className="text-xs uppercase tracking-[0.18em] text-muted">
          Profile
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-foreground">
          Your account
        </h1>

        <dl className="mt-8 space-y-4 text-sm">
          <ReadOnlyRow label="Email" value={profile?.email ?? ""} />
          <ReadOnlyRow
            label="Role"
            value={profile?.role === "professor" ? "Professor" : "Student"}
          />
        </dl>

        <div className="mt-8">
          <ProfileForm initialName={profile?.name ?? ""} />
        </div>
      </main>
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
