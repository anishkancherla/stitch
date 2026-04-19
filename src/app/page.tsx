import Link from "next/link";
import { Mark } from "@/components/Mark";
import { StitchCards } from "@/components/StitchCards";
import { TopBar } from "@/components/TopBar";

/**
 * Public landing page. Logged-in users get bounced to their dashboard
 * by the middleware before they ever see this.
 */
export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar />

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
        <div className="flex items-center gap-4 text-foreground">
          <Mark size={64} />
          <span className="font-display text-7xl font-medium tracking-tight">
            stitch
          </span>
        </div>

        <p className="mt-4 text-xl text-muted">review smarter, together</p>

        <StitchCards />

        <Link
          href="/signup"
          className="mt-12 rounded-xl bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
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
