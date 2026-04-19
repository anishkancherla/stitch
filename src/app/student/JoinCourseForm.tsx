"use client";

import { useActionState, useEffect, useRef } from "react";
import { joinCourse, type JoinCourseState } from "./actions";

export function JoinCourseForm() {
  const [state, formAction, pending] = useActionState<
    JoinCourseState,
    FormData
  >(joinCourse, undefined);

  const formRef = useRef<HTMLFormElement>(null);

  // Clear the input on a successful join so a second join doesn't carry
  // the stale code into the input box.
  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mt-6 rounded-3xl border border-zinc-300 bg-zinc-200 p-6"
    >
      <p className="text-sm text-foreground/70">
        Ask your professor for the 6-character join code.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          name="code"
          type="text"
          required
          maxLength={16}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="K7B2QP"
          className="h-12 flex-1 rounded-xl border border-border bg-background px-4 font-mono text-base uppercase tracking-widest outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
          style={{ textTransform: "uppercase" }}
        />
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-xl bg-foreground px-6 text-base font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Joining…" : "Join"}
        </button>
      </div>
      {state && "error" in state && (
        <p className="mt-3 px-2 text-sm text-rose-600">{state.error}</p>
      )}
      {state && "ok" in state && state.ok && (
        <p className="mt-3 px-2 text-sm text-emerald-600">
          Joined. Your course appears above.
        </p>
      )}
    </form>
  );
}
