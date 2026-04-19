import { redirect } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CardRow, SessionPlan } from "@/lib/spaces";
import { SpaceRoom } from "./SpaceRoom";

interface SpacePageProps {
  params: Promise<{ id: string }>;
}

export default async function SpacePage({ params }: SpacePageProps) {
  const { id: spaceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS reads — a non-member gets `null` here and we kick them out with a
  // friendly screen rather than the default Next 404.
  const { data: spaceRow } = await supabase
    .from("stitch_spaces")
    .select("id, course_id, status, current_step, plan_json, created_at, ended_at")
    .eq("id", spaceId)
    .maybeSingle();

  if (!spaceRow) {
    return <NotAMember />;
  }

  const plan = spaceRow.plan_json as SessionPlan | null;
  if (!plan) {
    return (
      <SpaceShell>
        <p className="text-sm text-muted">Plan not generated yet.</p>
      </SpaceShell>
    );
  }

  // Card rows + the course label + member display names. Admin client used
  // only for member name lookups since `users` RLS hides anyone but self.
  const admin = createAdminClient();

  const [{ data: cardRows }, { data: course }, { data: nameRows }] =
    await Promise.all([
      supabase
        .from("stitch_space_cards")
        .select("subconcept_id, target_user_id, status")
        .eq("space_id", spaceId),
      supabase
        .from("courses")
        .select("code, name")
        .eq("id", spaceRow.course_id)
        .maybeSingle(),
      admin
        .from("users")
        .select("id, name, email")
        .in(
          "id",
          plan.members.map((m) => m.userId)
        ),
    ]);

  const nameById = new Map(
    (nameRows ?? []).map((u) => [
      u.id as string,
      ((u.name as string) || "").trim() || (u.email as string) || "Student",
    ])
  );

  // Resolve subconcept labels for the cards from the plan steps (cheaper
  // than another DB read; every card's subconcept appears in the plan).
  const labelBySubId = new Map<string, { conceptLabel: string; subconceptLabel: string }>();
  for (const step of plan.steps) {
    labelBySubId.set(step.subconceptId, {
      conceptLabel: step.conceptLabel,
      subconceptLabel: step.subconceptLabel,
    });
  }

  const cards: CardRow[] = (cardRows ?? []).map((r) => {
    const meta = labelBySubId.get(r.subconcept_id as string);
    return {
      subconceptId: r.subconcept_id as string,
      targetUserId: r.target_user_id as string,
      status: r.status as CardRow["status"],
      conceptLabel: meta?.conceptLabel ?? "",
      subconceptLabel: meta?.subconceptLabel ?? "",
    };
  });

  return (
    <SpaceShell>
      <SpaceRoom
        spaceId={spaceId}
        courseId={spaceRow.course_id}
        courseLabel={
          course
            ? `${course.code as string} · ${course.name as string}`
            : "Course"
        }
        plan={plan}
        initialCurrentStep={spaceRow.current_step}
        initialStatus={spaceRow.status as "waiting" | "active" | "ended"}
        initialCards={cards}
        viewerUserId={user.id}
        memberNames={Object.fromEntries(
          plan.members.map((m) => [m.userId, nameById.get(m.userId) ?? m.name])
        )}
      />
    </SpaceShell>
  );
}

function SpaceShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <Link
            href="/student"
            className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
          >
            Leave
          </Link>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-6 pb-16">
        {children}
      </main>
    </div>
  );
}

function NotAMember() {
  return (
    <SpaceShell>
      <div className="rounded-2xl border border-border bg-zinc-50 px-6 py-12 text-center">
        <p className="text-sm text-muted">
          You don&apos;t have access to this Stitch Space, or it doesn&apos;t exist.
        </p>
        <Link
          href="/student"
          className="mt-4 inline-block text-sm font-medium text-foreground underline"
        >
          Back to dashboard
        </Link>
      </div>
    </SpaceShell>
  );
}
