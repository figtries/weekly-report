import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import StorageWarning from "@/components/layout/StorageWarning";
import { getDb, getLatestWeek } from "@/lib/data";

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
  const currentWeek = getLatestWeek(db) || 1;
  return (
    // data-scroll-behavior lets Next.js suspend smooth scrolling during route
    // transitions so page changes don't visibly scroll-animate.
    <html lang="en" data-scroll-behavior="smooth" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full flex flex-col lg:flex-row bg-gray-50 font-sans print:block print:h-auto">
        <Sidebar currentWeek={currentWeek} />
        <div className="flex-1 min-h-0 flex flex-col print:block print:h-auto">
          <StorageWarning />
          <main className="flex-1 min-h-0 overflow-auto print:h-auto print:overflow-visible">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
