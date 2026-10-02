import { initials } from "@/lib/format";

const TONES = ["#2b3a67", "#4c2f6b", "#5a3535", "#2f4f3a", "#4a3470", "#3d4a5c", "#5b4a2a"];

function toneFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

export function Avatar({ name, className = "size-11 text-[17px]" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: toneFor(name) }}
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-ink ${className}`}
    >
      {initials(name)}
    </span>
  );
}
