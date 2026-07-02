'use client';

export default function PrintTrigger({ label = 'Print Full Report' }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96]"
    >
      {label}
    </button>
  );
}
