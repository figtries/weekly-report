// Renders the print sheet ON-SCREEN (painted) while it is mounted, then lets
// @media print drop it into the normal page flow for paper.
//
// Why not offscreen? Chrome/Samsung Internet on Android print by rasterizing
// what was ALREADY PAINTED on screen. Anything far off-canvas (left:-9999px),
// display:none, visibility:hidden or opacity:0 is never painted, so Android
// captured an empty layer and printed a blank page — even though desktop and
// iOS (which re-lay-out for print) looked fine, which is why this kept slipping
// through. The sheet is only mounted during the brief print window (unmounted
// on `afterprint`), so covering the viewport for that moment is harmless and is
// the one state Android is guaranteed to rasterize. Recharts also needs real
// on-screen layout to draw its curves.
export default function PrintSheet({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-print-sheet
      aria-hidden="true"
      className="fixed inset-0 z-[9999] overflow-auto bg-white print:static print:z-auto print:overflow-visible"
    >
      {children}
    </div>
  );
}
