import type { Metadata } from "next";
import { connection } from "next/server";
import { Notes } from "@/components/notes/notes";
import { getSession } from "@/lib/auth/session";
import { listNotes, NOTE_TAGS } from "@/lib/life/notes";

export const metadata: Metadata = { title: "Notes · Atlas" };

export default async function NotesPage(props: PageProps<"/notes">) {
  await connection();
  const { note } = await props.searchParams;
  const emailConnected = Boolean(await getSession());
  return (
    <Notes
      notes={listNotes()}
      tags={[...NOTE_TAGS]}
      emailConnected={emailConnected}
      openNoteId={typeof note === "string" ? note : null}
    />
  );
}
