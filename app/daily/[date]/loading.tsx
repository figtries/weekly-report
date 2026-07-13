export default function DailyDetailLoading() {
  return (
    <div className="p-8 space-y-6 animate-loading-reveal">
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <div className="h-7 w-72 max-w-full rounded-lg animate-shimmer" />
          <div className="h-4 w-32 rounded animate-shimmer" />
        </div>
        <div className="h-9 w-40 rounded-lg animate-shimmer" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 h-5 w-48 rounded animate-shimmer" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-4 rounded animate-shimmer" style={{ width: `${90 - j * 8}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
