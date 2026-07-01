'use client';

export default function PrintTrigger({ label = 'Print Full Report' }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow active:scale-95"
    >
      {label}
    </button>
  );
}
