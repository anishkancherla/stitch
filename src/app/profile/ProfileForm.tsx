"use client";

import { useActionState } from "react";
import { updateProfile, type ProfileState } from "./actions";

export function ProfileForm({ initialName }: { initialName: string }) {
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(
    updateProfile,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted">Display name</span>
        <input
          name="name"
          type="text"
          required
          defaultValue={initialName}
          maxLength={80}
          className="h-11 rounded-full border border-border bg-background px-4 text-sm outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10"
        />
      </label>

      {state?.error && <p className="px-2 text-sm text-rose-600">{state.error}</p>}
      {state?.ok && <p className="px-2 text-sm text-emerald-600">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 h-11 self-start rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
