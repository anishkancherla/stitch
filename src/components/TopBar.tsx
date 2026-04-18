import Link from "next/link";
import { Mark } from "./Mark";

type Props = {
  /** Right-side action. Defaults to a "Sign in" pill linking to /login. */
  right?: React.ReactNode;
};

/**
 * Minimal top bar: small mark on the left, "stitch" wordmark in the center,
 * action on the right. Matches the chiron-style aesthetic.
 */
export function TopBar({ right }: Props) {
  return (
    <header className="grid grid-cols-3 items-center px-6 py-5">
      <div className="justify-self-start text-foreground">
        <Link href="/" aria-label="Stitch home" className="inline-flex">
          <Mark size={22} />
        </Link>
      </div>

      <Link
        href="/"
        className="justify-self-center font-display text-xl tracking-tight text-foreground"
      >
        stitch
      </Link>

      <div className="justify-self-end">
        {right ?? (
          <Link
            href="/login"
            className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
