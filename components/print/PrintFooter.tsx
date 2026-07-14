// The foot of every printed sheet. It sits under the content, not pinned to the
// bottom of the paper: a sheet has no fixed height on paper (see
// .print-sheet-a4), so there is nothing for `margin-top: auto` to push against.
export default function PrintFooter({
  docNo,
  page,
  total,
}: {
  docNo: string;
  page: number;
  total: number;
}) {
  return (
    <footer className="rpt-footer">
      <span>{docNo}</span>
      <span>
        Page {page} of {total}
      </span>
    </footer>
  );
}
