import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ALL_SECTIONS } from "@/lib/nav";

// Placeholder for every sidebar section that isn't built yet. Built ones have their own routes.

const BUILT = ["brief", "inbox", "calendar", "journal", "habits", "notes"];

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_SECTIONS.filter((s) => !BUILT.includes(s.slug)).map((s) => ({ section: s.slug }));
}

function findSection(slug: string) {
  const section = ALL_SECTIONS.find((s) => s.slug === slug);
  if (!section) notFound();
  return section;
}

export async function generateMetadata(props: PageProps<"/[section]">): Promise<Metadata> {
  const { section } = await props.params;
  return { title: `${findSection(section).label} · Atlas` };
}

export default async function SectionPage(props: PageProps<"/[section]">) {
  const { section: slug } = await props.params;
  const section = findSection(slug);
  const Icon = section.icon;

  return (
    <div className="grid h-full place-items-center p-6 pb-24 md:pb-6">
      <div className="max-w-sm text-center">
        <Icon className="mx-auto size-10 text-faint" strokeWidth={1.4} />
        <h1 className="mt-5 text-2xl font-bold tracking-tight">{section.label}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{section.blurb}</p>
        <p className="mt-6 inline-flex rounded-full border border-line-strong px-3 py-1 text-xs text-muted">Not built yet</p>
      </div>
    </div>
  );
}
