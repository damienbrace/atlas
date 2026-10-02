import type { Metadata } from "next";
import { Calendar } from "@/components/calendar/calendar";

export const metadata: Metadata = { title: "Calendar · Atlas" };

export default function CalendarPage() {
  return <Calendar />;
}
