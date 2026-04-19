"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Mark } from "@/components/Mark";
import { signup, type AuthState } from "../actions";

/* ----------------------------------------------------------------------------
 * Signup page
 *
 * Matches the login page exactly — same dark surface, same oversized stitch
 * mark, same form sizing, same header. Only the form body differs (extra
 * name input + role pill toggle). Keep visual parity between the two screens
 * so users feel like they're moving inside one product, not switching apps.
 * -------------------------------------------------------------------------- */

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signup,
    undefined
  );
  const [role, setRole] = useState<"professor" | "student">("student");

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
          href="/login"
          className="justify-self-end rounded-xl border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="flex items-center gap-4 text-white">
          <Mark size={56} />
          <span className="font-display text-6xl font-medium tracking-tight">
            stitch
          </span>
        </div>
        <h1 className="mt-10 font-display text-4xl font-medium tracking-tight text-white">
          Create your account
        </h1>
        <p className="mt-3 text-base text-white/60">
          Stitch your students into smarter study sessions.
        </p>

        <form
          action={formAction}
          className="mt-10 flex w-full max-w-md flex-col gap-3"
        >
          {/* Role toggle. Hidden input mirrors the React state into the form
              payload so the server action receives the right value. */}
          <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
            <RolePill
              active={role === "student"}
              onClick={() => setRole("student")}
              label="Student"
            />
            <RolePill
              active={role === "professor"}
              onClick={() => setRole("professor")}
              label="Professor"
            />
          </div>
          <input type="hidden" name="role" value={role} />

          <input
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Name"
            className="h-14 rounded-2xl border border-white/10 bg-white/5 px-5 text-base text-white placeholder:text-white/40 outline-none transition-colors focus:border-white/30 focus:bg-white/10"
          />
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
            minLength={6}
            autoComplete="new-password"
            placeholder="Password (min 6 chars)"
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
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-8 text-sm text-white/60">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-white underline-offset-4 hover:underline"
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
      className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white text-neutral-950"
          : "text-white/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
