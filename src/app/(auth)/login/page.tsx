"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Mark } from "@/components/Mark";
import { TopBar } from "@/components/TopBar";
import { login, type AuthState } from "../actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    undefined
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        right={
          <Link
            href="/signup"
            className="rounded-xl border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50"
          >
            Sign up
          </Link>
        }
      />

      <main className="flex flex-1 flex-col items-center px-6 pt-16">
        <div className="flex items-center gap-3 text-foreground">
          <Mark size={36} />
          <span className="font-display text-3xl tracking-tight">stitch</span>
        </div>
        <p className="mt-2 text-sm text-muted">welcome back</p>

        <form
          action={formAction}
          className="mt-10 flex w-full max-w-xs flex-col gap-3"
        >
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
            autoComplete="current-password"
            placeholder="password"
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
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted">
          No account?{" "}
          <Link
            href="/signup"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </p>
      </main>
    </div>
  );
}
