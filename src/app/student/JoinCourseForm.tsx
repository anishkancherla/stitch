"use client";

import { useActionState, useEffect, useRef } from "react";
import { joinCourse, type JoinCourseState } from "./actions";

export function JoinCourseForm() {
  const [state, formAction, pending] = useActionState<
    JoinCourseState,
    FormData
  >(joinCourse, undefined);

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mt-3 rounded-2xl border border-border bg-zinc-50 p-5"
    >
      <p className="text-sm font-medium text-foreground">Join a course</p>
      <p className="mt-0.5 text-xs text-muted">
        Ask your professor for the 6-character code.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          name="code"
          type="text"
          required
          maxLength={16}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="K7B2QP"
          className="h-11 flex-1 rounded-full border border-border bg-background px-4 font-mono text-sm uppercase tracking-widest outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
          style={{ textTransform: "uppercase" }}
        />
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-xl bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Joining…" : "Join"}
        </button>
      </div>
      {state && "error" in state && (
        <p className="mt-2 px-2 text-sm text-rose-600">{state.error}</p>
      )}
      {state && "ok" in state && state.ok && (
        <p className="mt-2 px-2 text-sm text-emerald-600">
          Joined. Your course appears above.
        </p>
      )}
    </form>
  );
}
