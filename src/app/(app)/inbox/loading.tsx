import { Sparkle } from "@/components/sparkle";

/** Shown while Gmail loads and Atlas reads new mail (the first visit can take a little while). */
export default function InboxLoading() {
  return (
    <div className="flex h-full min-h-0 gap-3 p-3 pb-[84px] md:pb-3">
      <section className="flex w-full flex-col rounded-2xl border border-line bg-panel px-5 pt-5 md:w-[340px] md:shrink-0 lg:w-[380px] xl:w-auto xl:flex-1">
        <h1 className="text-[34px] leading-none font-bold tracking-tight">Inbox</h1>
        <p role="status" className="mt-4 flex items-center gap-2 text-[14.5px] text-teal">
          <Sparkle className="size-4 animate-shimmer" />
          Atlas is reading your inbox…
        </p>
        <ul aria-hidden="true" className="mt-5 flex flex-col gap-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="flex gap-3.5" style={{ animationDelay: `${i * 100}ms` }}>
              <span className="size-11 shrink-0 animate-shimmer rounded-full bg-raised" />
              <span className="flex flex-1 flex-col gap-2 pt-1">
                <span className="h-3 w-2/5 animate-shimmer rounded-full bg-raised" />
                <span className="h-3 w-4/5 animate-shimmer rounded-full bg-raised" />
                <span className="h-3 w-3/5 animate-shimmer rounded-full bg-raised" />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="hidden flex-1 rounded-2xl border border-line bg-panel md:block xl:flex-[1.95]" />
    </div>
  );
}
