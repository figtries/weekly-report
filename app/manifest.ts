import type { MetadataRoute } from "next";

/**
 * Every entry here declared a size it did not have.
 *
 * All three pointed at `/report.png`, which is 1254x1254 and 848 KB, while
 * claiming to be 192 and 512. A browser believes the manifest: it picks the
 * entry whose declared size fits and downloads it, so the 192px slot cost 848
 * KB. It was traced arriving in the middle of a click into a project, taking
 * bandwidth from the page being opened. The sizes are real now — 47 KB and 297
 * KB — cut from the same original by `scripts/make-icons.mjs`.
 *
 * `maskable` keeps the 512: Android crops a maskable icon to whatever shape the
 * launcher uses, so it is the one that must not be short of pixels.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Weekly Progress Report",
    short_name: "Report",
    description:
      "Weekly Progress Report System - Track project progress and generate reports",
    start_url: "/",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#f9fafb",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
