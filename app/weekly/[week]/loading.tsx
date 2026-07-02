// Instant skeleton while a weekly tab renders on the server — the tap commits
// immediately instead of freezing on the old page.
export default function WeeklyLoading() {
  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="space-y-2">
        <div className="h-8 w-64 rounded-lg animate-shimmer" />
        <div className="h-4 w-96 max-w-full rounded-md animate-shimmer" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 h-3 w-20 rounded animate-shimmer" />
            <div className="h-8 w-24 rounded-md animate-shimmer" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="h-5 w-48 rounded animate-shimmer" />
        </div>
        <div className="space-y-3 p-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 rounded animate-shimmer" style={{ width: `${92 - i * 6}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
