import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone reaches the dev server over Tailscale: through Tailscale Serve
  // (https://damo-gaming.tail8673c4.ts.net) or directly at the PC's Tailscale IP over http.
  // List hosts exactly: "*.ts.net" only matches one level, e.g. "x.ts.net".
  allowedDevOrigins: ["damo-gaming.tail8673c4.ts.net", "100.123.112.46"],
};

export default nextConfig;
