export default function DailyLoading() {
  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-8 space-y-2">
        <div className="h-8 w-56 rounded-lg animate-shimmer" />
        <div className="h-4 w-80 max-w-full rounded-md animate-shimmer" />
      </div>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between px-6 py-4">
            <div className="space-y-2">
              <div className="h-4 w-52 rounded animate-shimmer" />
              <div className="h-3 w-24 rounded animate-shimmer" />
            </div>
            <div className="h-3 w-32 rounded animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
