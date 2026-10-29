/** Two tracks as opposite-phase waves that cross and blend ("oil and water"). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path
        d="M10 32 C 18 12, 26 12, 32 32 S 46 52, 54 32"
        fill="none"
        stroke="var(--oil)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M10 32 C 18 52, 26 52, 32 32 S 46 12, 54 32"
        fill="none"
        stroke="var(--water)"
        strokeWidth="6"
        strokeLinecap="round"
        style={{ mixBlendMode: "screen" }}
      />
    </svg>
  );
}
