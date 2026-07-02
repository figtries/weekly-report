'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    {
      name: 'Weekly Report',
      href: '/weekly',
      match: '/weekly',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 12l3-3 3 3 4-4M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"
          />
        </svg>
      ),
    },
    {
      name: 'Daily Report',
      href: '/daily',
      match: '/daily',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ),
    },
  ];

  return (
    <aside className="w-56 h-screen bg-white border-r border-gray-200 print:hidden flex-shrink-0">
      <div className="flex flex-col h-full">
        <div className="h-16 flex items-center px-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <Image
              src="/figtries-logo (1).png"
              alt="Figtries"
              width={32}
              height={32}
              className="object-contain"
            />
            <div>
              <h1 className="text-base font-semibold text-gray-900">Figtries</h1>
              <p className="text-xs text-gray-500">Progress Report</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.match);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ease-ios active:scale-[0.97] ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)]'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="transition-transform duration-300 ease-spring group-hover:scale-110">
                  {item.icon}
                </span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
