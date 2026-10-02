import { addDays, shortDay } from "@/lib/life/days";
import { AREA_COLORS, type TaskArea } from "@/lib/life/task-rules";

// Small pieces shared by the Tasks list, its dialog and the email view.

export function AreaChip({ area }: { area: TaskArea }) {
  const color = AREA_COLORS[area];
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap"
      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}14` }}
    >
      {area}
    </span>
  );
}

/** Red when overdue, amber for today, plain otherwise. */
export function DueChip({ dueDay, today }: { dueDay: string; today: string }) {
  if (dueDay < today) return <span className="text-[12.5px] whitespace-nowrap text-red">Overdue · {shortDay(dueDay)}</span>;
  if (dueDay === today) return <span className="text-[12.5px] whitespace-nowrap text-amber">Today</span>;
  const label = dueDay === addDays(today, 1) ? "Tomorrow" : shortDay(dueDay);
  return <span className="text-[12.5px] whitespace-nowrap text-muted">{label}</span>;
}

/** Quick dates offered when adding, editing or snoozing. */
export function quickDays(today: string) {
  return [
    { label: "Today", day: today },
    { label: "Tomorrow", day: addDays(today, 1) },
    { label: "Next week", day: addDays(today, 7) },
    { label: "Someday", day: null },
  ];
}
