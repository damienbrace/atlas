import { redirect } from "next/navigation";

// Notes live in Obsidian now, so Atlas has no Notes page.
export default function NotesPage() {
  redirect("/brief");
}
