// Keeps a mounted print sheet out of view WITHOUT hiding it from the paint
// pipeline. Do not "simplify" to display:none, visibility:hidden or opacity:0:
// Android Chrome's print rasterizer only outputs subtrees that were already
// painted on screen, so all three variants printed blank pages on Android
// (desktop and iOS were fine, which is why this kept slipping through).
// Offscreen-left keeps the sheet laid out AND painted — Recharts also needs
// real layout to draw — and @media print restores it into the flow. Same
// technique as DailyForm's print sheet, which is proven on Android.
export default function PrintSheet({ children }: { children: React.ReactNode }) {
  return (
    <div data-print-sheet aria-hidden="true" className="absolute -left-[9999px] top-0 print:static">
      {children}
    </div>
  );
}
