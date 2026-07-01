'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewDailyButton({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch('/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error ?? 'Failed to create daily report');
        return;
      }
      router.push(`/daily/${date}`);
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600"
      />
      <button
        onClick={create}
        disabled={creating}
        className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-50"
      >
        {creating ? 'Creating…' : '+ New Daily Report'}
      </button>
    </div>
  );
}
