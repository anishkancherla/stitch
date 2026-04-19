"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Mark } from "@/components/Mark";
import { login, type AuthState } from "../actions";

/* ----------------------------------------------------------------------------
 * Login page
 *
 * Dark, focused, oversized — meant to feel like a moment, not a form. Custom
 * top bar so the wordmark and "Sign up" link can read on the dark surface
 * without touching the shared TopBar component.
 * -------------------------------------------------------------------------- */

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    undefined
  );

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-white">
      <header className="grid grid-cols-3 items-center px-6 py-5">
        <Link
          href="/"
          aria-label="Stitch home"
          className="inline-flex justify-self-start text-white"
        >
          <Mark size={22} />
        </Link>
        <Link
          href="/"
          className="justify-self-center font-display text-xl font-medium tracking-tight text-white"
        >
          stitch
        </Link>
        <Link
          href="/signup"
          className="justify-self-end rounded-xl border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          Sign up
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-20">
        <div className="flex items-center gap-4 text-white">
          <Mark size={56} />
          <span className="font-display text-6xl font-medium tracking-tight">
            stitch
          </span>
        </div>
        <h1 className="mt-10 font-display text-4xl font-medium tracking-tight text-white">
          Welcome back
        </h1>
        <p className="mt-3 text-base text-white/60">
          Sign in to keep building your courses.
        </p>

        <form
          action={formAction}
          className="mt-10 flex w-full max-w-md flex-col gap-3"
        >
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@school.edu"
            className="h-14 rounded-2xl border border-white/10 bg-white/5 px-5 text-base text-white placeholder:text-white/40 outline-none transition-colors focus:border-white/30 focus:bg-white/10"
          />
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className="h-14 rounded-2xl border border-white/10 bg-white/5 px-5 text-base text-white placeholder:text-white/40 outline-none transition-colors focus:border-white/30 focus:bg-white/10"
          />

          {state?.error && (
            <p className="px-2 text-sm text-rose-400">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 h-14 rounded-2xl bg-white text-base font-medium text-neutral-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-8 text-sm text-white/60">
          No account?{" "}
          <Link
            href="/signup"
            className="font-medium text-white underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </p>
      </main>
    </div>
  );
}
