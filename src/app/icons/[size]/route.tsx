import { ImageResponse } from "next/og";

// App icons for the manifest, drawn from the Atlas sparkle: /icons/192, /icons/512,
// /icons/maskable (extra padding so Android's mask shapes never clip the mark) and
// /icons/badge (white on transparent, for the status bar when a notification arrives).

const SIZES: Record<string, { size: number; mark: number; badge?: boolean }> = {
  "192": { size: 192, mark: 0.62 },
  "512": { size: 512, mark: 0.62 },
  maskable: { size: 512, mark: 0.46 },
  badge: { size: 96, mark: 0.86, badge: true },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_request: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size: key } = await ctx.params;
  const spec = SIZES[key];
  if (!spec) return new Response("Not found", { status: 404 });
  const mark = Math.round(spec.size * spec.mark);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: spec.badge ? "transparent" : "#0b0d11",
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 27 28" fill={spec.badge ? "#ffffff" : "#2dd4bf"}>
          <path d="M15 1Q16.6 9.4 25 11Q16.6 12.6 15 21Q13.4 12.6 5 11Q13.4 9.4 15 1Z" />
          <path d="M6 17.5Q6.7 21.3 10.5 22Q6.7 22.7 6 26.5Q5.3 22.7 1.5 22Q5.3 21.3 6 17.5Z" />
        </svg>
      </div>
    ),
    { width: spec.size, height: spec.size },
  );
}
