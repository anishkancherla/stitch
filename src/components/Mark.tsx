/**
 * Stitch wordmark icon. Two interlocking arcs — a "stitch" motif.
 * Single SVG, sized via the `size` prop. Inherits color via currentColor.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 22 C 6 12, 14 12, 14 22"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M18 10 C 18 20, 26 20, 26 10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="6" cy="22" r="1.4" fill="currentColor" />
      <circle cx="14" cy="22" r="1.4" fill="currentColor" />
      <circle cx="18" cy="10" r="1.4" fill="currentColor" />
      <circle cx="26" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}
