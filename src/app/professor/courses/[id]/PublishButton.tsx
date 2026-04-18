"use client";

import { useTransition } from "react";
import { publishCourse } from "../../actions";

export function PublishButton({ courseId }: { courseId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await publishCourse(courseId);
        })
      }
      className="h-10 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Publishing…" : "Publish course"}
    </button>
  );
}
