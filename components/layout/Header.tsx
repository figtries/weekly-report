'use client';

export default function Header() {
  return (
    <header className="h-16 bg-white border-b border-gray-200 print:hidden flex items-center px-6">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-medium text-gray-900">Project Overview</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">Week 35</span>
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-xs font-medium text-gray-600">U</span>
          </div>
        </div>
      </div>
    </header>
  );
}
