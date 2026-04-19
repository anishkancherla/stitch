"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Mark } from "@/components/Mark";
import { TopBar } from "@/components/TopBar";
import { signup, type AuthState } from "../actions";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signup,
    undefined
  );
  const [role, setRole] = useState<"professor" | "student">("student");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <Link
            href="/login"
            className="rounded-xl border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
          >
            Sign in
          </Link>
        }
      />

      <main className="flex flex-1 flex-col items-center px-6 pt-16 pb-12">
        <div className="flex items-center gap-3 text-foreground">
          <Mark size={36} />
          <span className="font-display text-3xl tracking-tight">stitch</span>
        </div>
        <p className="mt-2 text-sm text-muted">create your account</p>

        <form
          action={formAction}
          className="mt-10 flex w-full max-w-xs flex-col gap-3"
        >
          <div className="flex gap-1 rounded-full border border-border bg-zinc-50 p-1">
            <RolePill
              active={role === "student"}
              onClick={() => setRole("student")}
              label="student"
            />
            <RolePill
              active={role === "professor"}
              onClick={() => setRole("professor")}
              label="professor"
            />
          </div>
          <input type="hidden" name="role" value={role} />

          <input
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="full name"
            className="h-11 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
          />
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@school.edu"
            className="h-11 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
          />
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="password (min 6 chars)"
            className="h-11 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
          />

          {state?.error && (
            <p className="px-2 text-sm text-rose-600">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 h-11 rounded-xl bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}

function RolePill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
