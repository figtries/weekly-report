import type { MetadataRoute } from "next";

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
        src: "/report.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/report.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/report.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
