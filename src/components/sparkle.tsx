/** Atlas mark: a large four-point star with a small one below it. Marks anything the assistant wrote. */
export function Sparkle({ className = "size-6", glow = false }: { className?: string; glow?: boolean }) {
  return (
    <svg
      viewBox="0 0 27 28"
      fill="currentColor"
      aria-hidden="true"
      className={`shrink-0 text-teal ${glow ? "drop-shadow-[0_0_8px_rgba(45,212,191,0.55)]" : ""} ${className}`}
    >
      <path d="M15 1Q16.6 9.4 25 11Q16.6 12.6 15 21Q13.4 12.6 5 11Q13.4 9.4 15 1Z" />
      <path d="M6 17.5Q6.7 21.3 10.5 22Q6.7 22.7 6 26.5Q5.3 22.7 1.5 22Q5.3 21.3 6 17.5Z" />
    </svg>
  );
}
