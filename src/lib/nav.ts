import {
  CalendarDays,
  ChartColumn,
  Flame,
  GitFork,
  History,
  House,
  NotebookPen,
  Settings,
  SquareCheck,
  type LucideIcon,
} from "lucide-react";

export interface Section {
  slug: string;
  label: string;
  icon: LucideIcon;
  /** One line shown on the placeholder page until the screen is built. */
  blurb: string;
}

export const SECTIONS: Section[] = [
  { slug: "brief", label: "Brief", icon: House, blurb: "Today's jobs, replies needed, bills due and the weather." },
  { slug: "calendar", label: "Calendar", icon: CalendarDays, blurb: "Site visits, calls and bookings in one view." },
  { slug: "journal", label: "Journal", icon: NotebookPen, blurb: "A page a day, in your own words." },
  { slug: "habits", label: "Habits", icon: Flame, blurb: "Daily habits, ticked off and kept as streaks." },
  { slug: "tasks", label: "Tasks", icon: SquareCheck, blurb: "Everything to do, from typing, voice notes and email." },
  { slug: "money", label: "Money", icon: ChartColumn, blurb: "Personal spending from bank CSVs, sorted by Atlas." },
  { slug: "decisions", label: "Decisions", icon: GitFork, blurb: "Big calls logged with a prediction, scored six months later." },
  { slug: "review", label: "Review", icon: History, blurb: "Planned vs actual time, wins and slips for the week." },
];

export const SETTINGS: Section = {
  slug: "settings",
  label: "Settings",
  icon: Settings,
  blurb: "Accounts, connections and how Atlas behaves.",
};

export const ALL_SECTIONS = [...SECTIONS, SETTINGS];
