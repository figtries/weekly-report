import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import StorageWarning from "@/components/layout/StorageWarning";
import { MotionRoot } from "@/components/motion/MotionRoot";
import { getDb, getLatestWeek, getProjects } from "@/lib/data";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Weekly Progress Report",
  description: "Weekly Progress Report System - Track project progress and generate reports",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // getDb is 'use cache' (tag: 'db'), so the sidebar's week-scoped sub-links
  // stay part of the static shell and refresh when the current week changes.
  const db = await getDb();
  const projects = await getProjects();
  const currentWeek = getLatestWeek(db) || 1;
  return (
    // data-scroll-behavior lets Next.js suspend smooth scrolling during route
    // transitions so page changes don't visibly scroll-animate.
    <html lang="en" data-scroll-behavior="smooth" className={`${inter.variable} h-full antialiased`}>
      {/* THE APP IS LIGHT, DELIBERATELY. A `ThemeProvider` was mounted here for
          a few hours and taken back out: the point of the token pass was one
          palette written down once, not two palettes to keep in step. Every
          surface reads its colour from the `@theme inline` block in
          globals.css, so `bg-background` here is the same #f9fafb the app has
          always had — the value simply has a name now.

          The dormant `.dark` block at the bottom of globals.css is left where
          it is. Turning it on is mounting a provider around this body and
          nothing else; what it WOULD need first is the Daily section, which
          still writes its greys by hand. */}
      <body className="h-full flex flex-col lg:flex-row bg-background font-sans print:block print:h-auto">
        {/* The motion provider wraps the WHOLE body, not <main>. Sidebar is a
            sibling of <main>, and a provider around <main> alone would leave
            the app's primary navigation outside it — where framer-motion
            elements render featureless and simply sit still, with no error to
            tell you. MotionRoot adds no DOM, so the flex layout above still
            applies to Sidebar and the div exactly as it did. */}
        <MotionRoot>
          <Sidebar currentWeek={currentWeek} projects={projects} />
          <div className="flex-1 min-h-0 flex flex-col print:block print:h-auto">
            <StorageWarning />
            {/* No transition boundary here, deliberately. Knowing which route is
                being rendered means reading the pathname, and an uncached read in
                THIS file blocks every route in the app — it failed the build on
                /print/daily/[date] once already. The boundaries live in the
                sections and pages, which know who they are for free. */}
            <main className="flex-1 min-h-0 overflow-auto print:h-auto print:overflow-visible">
              {children}
            </main>
          </div>
        </MotionRoot>
      </body>
    </html>
  );
}
