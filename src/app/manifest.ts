import type { MetadataRoute } from "next";

/** Makes Atlas installable on Android ("Install app" / "Add to home screen"). Needs https. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas",
    short_name: "Atlas",
    description: "Personal AI assistant: email, calendar, journal, habits and notes.",
    start_url: "/brief",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d11",
    theme_color: "#0b0d11",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
