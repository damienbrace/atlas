import { CalendarDays, ChevronRight, Cloud, CloudRain, Flame, Mail, NotebookPen, Sun, ThermometerSun } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { Sparkle } from "@/components/sparkle";
import type { BriefData } from "@/lib/brief";
import type { BriefSection } from "@/lib/brief-sections";
import { calendarFor } from "@/lib/calendar/calendars";
import { shortDate, timeLabel } from "@/lib/calendar/dates";
import { longDay } from "@/lib/life/days";
import type { Weather } from "@/lib/weather";
import { BriefLayout, Card, CustomiseButton, HideButton, NothingShown, Show, Summary } from "./brief-layout";
import { BriefHabits, BriefTasks } from "./brief-lists";

// The home screen: today at a glance. Rendered on the server; ticks and the show/hide
// controls are interactive.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pieces of Atlas's one-line read of the day, each tagged with the part of the Brief it comes from. */
function summaryParts(data: BriefData) {
  const parts: { section: BriefSection; text: string }[] = [];
  if (data.replies.length) parts.push({ section: "needs", text: `${plural(data.replies.length, "reply", "replies")} needed` });
  if (data.calendar.status === "ok") {
    const n = data.calendar.events.length;
    parts.push({ section: "today", text: n ? `${plural(n, "event")} today` : "a clear calendar" });
  }
  if (data.weather?.rainFrom) parts.push({ section: "weather", text: `showers likely from ${data.weather.rainFrom}` });
  else if (data.weather?.hot) parts.push({ section: "weather", text: `a hot one at ${data.weather.today.high}°` });
  const left = data.habits.length - data.habitsDone.length;
  if (left > 0) parts.push({ section: "habits", text: `${plural(left, "habit")} to tick off` });
  const dueTasks = data.tasks.filter((t) => !t.done && t.dueDay !== null && t.dueDay <= data.today).length;
  if (dueTasks) parts.push({ section: "needs", text: `${plural(dueTasks, "task")} due` });
  return parts;
}

function WeatherGlyph({ weather }: { weather: Weather }) {
  const className = "size-[18px]";
  if (weather.rainFrom) return <CloudRain className={className} />;
  if (weather.hot) return <ThermometerSun className={className} />;
  return weather.now.label === "Clear" ? <Sun className={className} /> : <Cloud className={className} />;
}

export function Brief({ data }: { data: BriefData }) {
  const { weather } = data;

  return (
    <BriefLayout initialHidden={data.hidden}>
      <div className="h-full overflow-y-auto p-3 pb-[84px] scroll-thin md:pb-3 lg:p-5">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 lg:gap-4">
          <header className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <h1 className="text-[30px] leading-tight font-bold tracking-tight md:text-[34px]">
                {data.greeting}, {data.name}
              </h1>
              <p className="mt-1.5 text-[15px] text-muted">{longDay(data.today)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {weather && (
                <Show id="weather">
                  <p
                    title={`${weather.place}: ${weather.today.label}, ${weather.today.low}° to ${weather.today.high}°, ${weather.today.rainChance}% chance of rain`}
                    className={`flex h-10 items-center gap-2 rounded-full border pr-1.5 pl-4 text-[14.5px] ${
                      weather.rainFrom || weather.hot ? "border-amber/50 text-amber" : "border-line-strong text-ink-soft"
                    }`}
                  >
                    <WeatherGlyph weather={weather} />
                    {weather.headline}
                    <HideButton id="weather" />
                  </p>
                </Show>
              )}
              <CustomiseButton />
            </div>
          </header>

          <Show id="summary">
            <section
              aria-label="Atlas summary"
              className="flex items-center gap-4 rounded-2xl border border-l-[3px] border-line border-l-teal bg-card py-4 pr-3 pl-5"
            >
              <Sparkle className="size-7" glow />
              <Summary parts={summaryParts(data)} />
              <HideButton id="summary" />
            </section>
          </Show>

          <NothingShown />

          {/* Columns share out whatever is still shown. */}
          <div className="grid items-start gap-3 lg:grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] lg:gap-4">
            <Card id="today" title="Today" icon={<CalendarDays className="size-5 text-muted" strokeWidth={1.75} />} href="/calendar">
              <TodayEvents data={data} />
              {weather && (
                <Show id="weather">
                  <Outlook weather={weather} />
                </Show>
              )}
            </Card>

            <Card id="needs" title="Needs you" icon={<Mail className="size-5 text-muted" strokeWidth={1.75} />} href="/inbox">
              <Replies data={data} />
              <h3 className="mt-5 mb-1 px-2 text-[12.5px] font-semibold tracking-wide text-faint uppercase">Tasks</h3>
              <BriefTasks tasks={data.tasks} today={data.today} />
            </Card>

            <div className="flex flex-col gap-3 empty:hidden lg:gap-4">
              <Card id="habits" title="Habits" icon={<Flame className="size-5 text-muted" strokeWidth={1.75} />} href="/habits">
                {data.habits.length ? (
                  <BriefHabits habits={data.habits} done={data.habitsDone} today={data.today} />
                ) : (
                  <Empty>
                    No habits yet. <Link href="/habits" className="text-ink underline-offset-2 hover:underline">Add a few</Link> to track them here.
                  </Empty>
                )}
              </Card>
              <Card id="journal" title="Journal" icon={<NotebookPen className="size-5 text-muted" strokeWidth={1.75} />} href="/journal">
                <Link
                  href="/journal"
                  className="flex items-center justify-between gap-3 rounded-xl border border-line-strong px-4 py-3.5 hover:border-faint"
                >
                  <span>
                    <span className="block text-[15px] font-semibold">
                      {data.journalWords ? "Today's entry is written" : "Write today's entry"}
                    </span>
                    <span className="text-[13.5px] text-muted">
                      {data.journalWords ? `${plural(data.journalWords, "word")} so far` : "A few lines is enough."}
                    </span>
                  </span>
                  <ChevronRight className="size-5 text-muted" />
                </Link>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </BriefLayout>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-[14px] text-muted">{children}</p>;
}

const connectLink = (label: string) => (
  // A plain <a>: this route redirects to Google's consent screen and must not be prefetched.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  <a href="/api/auth/google" className="font-semibold text-teal hover:underline">
    {label}
  </a>
);

function TodayEvents({ data }: { data: BriefData }) {
  const { calendar } = data;
  if (calendar.status === "not-connected") return <Empty>Connect Google to see today&apos;s events. {connectLink("Connect")}</Empty>;
  if (calendar.status === "needs-permission") return <Empty>Let Atlas read your calendar to show today&apos;s events. {connectLink("Connect Google Calendar")}</Empty>;
  if (calendar.status === "error") return <Empty>Couldn&apos;t reach Google Calendar just now.</Empty>;
  if (calendar.events.length === 0) return <Empty>Nothing in the calendar today.</Empty>;

  return (
    <ol className="flex flex-col">
      {calendar.events.map((e) => (
        <li key={e.id} className="flex gap-3 rounded-xl px-2 py-2.5">
          <span className="w-[4.5rem] shrink-0 pt-px text-[14px] text-muted tabular-nums">{e.start ? timeLabel(e.start) : "All day"}</span>
          <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${calendarFor(e.calendar).dot}`} />
          <span className="min-w-0">
            <span className="block text-[15px] font-medium [overflow-wrap:anywhere]">{e.title}</span>
            {e.location && <span className="block truncate text-[13px] text-muted">{e.location}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Outlook({ weather }: { weather: Weather }) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="px-2 text-[12.5px] font-semibold tracking-wide text-faint uppercase">Next few days · {weather.place}</p>
      <ul className="mt-2 grid grid-cols-3 gap-2">
        {weather.next.slice(0, 3).map((d) => (
          <li key={d.date} className="rounded-xl bg-card px-3 py-2.5 text-[13px]">
            <span className="block font-semibold">{shortDate(d.date).split(" ")[0]}</span>
            <span className="block text-ink-soft tabular-nums">
              {d.high}° / {d.low}°
            </span>
            <span className={`block ${d.rainChance >= 50 ? "text-amber" : "text-muted"}`}>
              {d.rainChance >= 50 ? `Rain ${d.rainChance}%` : d.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Replies({ data }: { data: BriefData }) {
  if (!data.gmailConnected) return <Empty>Connect Gmail to see what needs a reply. {connectLink("Connect")}</Empty>;
  return (
    <>
      {data.replies.length === 0 ? (
        <Empty>{data.stillSorting ? "Atlas is still sorting your recent mail…" : "No replies waiting on you."}</Empty>
      ) : (
        <ul className="flex flex-col">
          {data.replies.map((e) => (
            <li key={e.id}>
              <Link href={`/inbox?thread=${e.threadId}`} className="flex gap-3 rounded-xl px-2 py-2.5 hover:bg-white/[0.03]">
                <Avatar name={e.from.name} className="size-9 text-[14px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-semibold">{e.from.name}</span>
                    <span className="size-2 shrink-0 rounded-full bg-amber" aria-label="Needs a reply" />
                  </span>
                  <span className="block truncate text-[14px]">{e.headline}</span>
                  {e.summary && <span className="block truncate text-[13px] text-muted">{e.summary}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.waiting.length > 0 && (
        <>
          <h3 className="mt-5 mb-1 px-2 text-[12.5px] font-semibold tracking-wide text-faint uppercase">Waiting on</h3>
          <ul className="flex flex-col">
            {data.waiting.map((e) => (
              <li key={e.id}>
                <Link href={`/inbox?thread=${e.threadId}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                  <span className="size-2 shrink-0 rounded-full bg-violet" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    <span className="font-medium">{e.to[0]?.name}</span>
                    <span className="text-muted"> · {e.headline}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
