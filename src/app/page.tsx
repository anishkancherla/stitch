import Link from "next/link";
import { Mark } from "@/components/Mark";
import { TopBar } from "@/components/TopBar";

/**
 * Public landing page. Logged-in users get bounced to their dashboard
 * by the middleware before they ever see this.
 */
export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar />

      <main className="flex flex-1 flex-col items-center px-6 pt-24">
        <div className="flex items-center gap-3 text-foreground">
          <Mark size={44} />
          <span className="font-display text-5xl tracking-tight">stitch</span>
        </div>

        <p className="mt-3 text-base text-muted">
          course mastery from your professor&apos;s lectures
        </p>

        <SubjectStrip />

        <Link
          href="/signup"
          className="mt-10 rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Get started
        </Link>

        <p className="mt-4 text-sm text-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted">
        Built at CitrusHacks · 2026
      </footer>
    </div>
  );
}

/**
 * Fan of subject "cards" loosely echoing the chiron portrait strip.
 * Pure CSS — no images. Each card is a label on a soft tint, slightly
 * rotated so the row reads as a hand-of-cards.
 */
function SubjectStrip() {
  const subjects: { label: string; tint: string }[] = [
    { label: "Algorithms", tint: "bg-rose-50" },
    { label: "Linear Algebra", tint: "bg-amber-50" },
    { label: "Organic Chem", tint: "bg-lime-50" },
    { label: "Macro­economics", tint: "bg-sky-50" },
    { label: "Neuroscience", tint: "bg-violet-50" },
    { label: "Constitutional Law", tint: "bg-orange-50" },
    { label: "Thermodynamics", tint: "bg-teal-50" },
  ];

  const center = (subjects.length - 1) / 2;

  return (
    <div className="mt-10 flex items-center justify-center">
      {subjects.map((s, i) => {
        const offset = i - center;
        const rotate = offset * 4; // degrees
        const translateY = Math.abs(offset) * 4; // px — fan downward at edges
        return (
          <div
            key={s.label}
            className={`-mx-3 flex h-28 w-24 items-center justify-center rounded-xl border border-border ${s.tint} text-center text-[11px] font-medium text-foreground/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)]`}
            style={{
              transform: `rotate(${rotate}deg) translateY(${translateY}px)`,
              zIndex: 10 - Math.abs(offset),
            }}
          >
            <span className="px-2 leading-tight">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
