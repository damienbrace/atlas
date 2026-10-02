import type { Metadata } from "next";
import { Sparkle } from "@/components/sparkle";

export const metadata: Metadata = { title: "Sign in · Atlas" };

// Outcomes of the Google sign-in flow, passed back as ?error=…
const PROBLEMS: Record<string, string> = {
  "not-configured": "Atlas's Google keys aren't set up on the server yet.",
  denied: "You weren't signed in because access was declined on Google's screen.",
  failed: "Signing in didn't work. Try again.",
  "missing-permission": "Atlas needs permission to read your email. Tick that box on Google's screen and try again.",
  "not-owner": "That Google account isn't allowed into this Atlas. Sign in with your own account.",
};

export default async function SignInPage(props: PageProps<"/signin">) {
  const { error } = await props.searchParams;
  const problem = typeof error === "string" ? PROBLEMS[error] : undefined;

  return (
    <main className="grid h-full place-items-center overflow-y-auto bg-canvas px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <Sparkle className="mx-auto size-14" glow />
        <h1 className="mt-5 text-[28px] font-bold tracking-tight">Atlas</h1>
        <p className="mt-2 text-[15.5px] leading-relaxed text-muted">Your email, calendar, journal and notes, in one place.</p>
        {problem && (
          <p role="alert" className="mt-6 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-[14.5px] text-amber">
            {problem}
          </p>
        )}
        {/* A plain <a>, not <Link>: this route redirects to Google's consent screen and must not be prefetched. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/auth/google"
          className="mt-8 flex h-12 items-center justify-center rounded-xl bg-teal text-[16px] font-semibold text-canvas hover:opacity-90"
        >
          Sign in with Google
        </a>
        <p className="mt-4 text-[13px] text-faint">Only the owner&apos;s Google account can sign in.</p>
      </div>
    </main>
  );
}
