import Link from "next/link";

// Two-tab nav for the prof course view: the existing class ribbon + the new
// per-student roster. Server component — `active` is passed by the page that
// renders it, no client state needed. Styling is intentionally restrained so
// it sits below the course title without competing for attention.

type Tab = "overview" | "students";

interface CourseTabsProps {
  courseId: string;
  active: Tab;
}

const TABS: Array<{ id: Tab; label: string; href: (id: string) => string }> = [
  { id: "overview", label: "Overview", href: (id) => `/professor/courses/${id}` },
  {
    id: "students",
    label: "Students",
    href: (id) => `/professor/courses/${id}/students`,
  },
];

export function CourseTabs({ courseId, active }: CourseTabsProps) {
  return (
    <nav className="mt-8 flex gap-6 border-b border-border">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href(courseId)}
            className={[
              "relative -mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
