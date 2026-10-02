import type { ComponentProps } from "react";

export const iconButtonClass =
  "grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-teal disabled:pointer-events-none disabled:opacity-40";

/** Square icon-only button. `label` doubles as the tooltip and accessible name. */
export function IconButton({ label, className = "", ...props }: ComponentProps<"button"> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={`${iconButtonClass} ${className}`} {...props} />;
}
