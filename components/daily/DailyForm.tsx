'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DailyReport, HseRow, ManHourRow, NonEffectiveRow, PtwRow } from '@/lib/types';

let rowIdCounter = 0;
function newRowId(prefix: string) {
  rowIdCounter += 1;
  return `${prefix}-${Date.now()}-${rowIdCounter}`;
}

export default function DailyForm({ report }: { report: DailyReport }) {
  const router = useRouter();
  const [form, setForm] = useState<DailyReport>(report);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function update<K extends keyof DailyReport>(key: K, value: DailyReport[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function updateWeather<K extends keyof DailyReport['weather']>(key: K, value: DailyReport['weather'][K]) {
    setForm((prev) => ({ ...prev, weather: { ...prev.weather, [key]: value } }));
    setDirty(true);
  }

  function updateManHour(id: string, patch: Partial<ManHourRow>) {
    update(
      'manHours',
      form.manHours.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }
  function addManHour() {
    update('manHours', [...form.manHours, { id: newRowId('mh'), company: '', pobQty: 0, previousHours: 0, todayHours: 0 }]);
  }
  function removeManHour(id: string) {
    update('manHours', form.manHours.filter((r) => r.id !== id));
  }

  function updateNonEffective(id: string, patch: Partial<NonEffectiveRow>) {
    update(
      'nonEffective',
      form.nonEffective.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  function updateHse(id: string, patch: Partial<HseRow>) {
    update(
      'hseInput',
      form.hseInput.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  function updatePtw(id: string, patch: Partial<PtwRow>) {
    update(
      'ptw',
      form.ptw.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }
  function addPtw() {
    update('ptw', [
      ...form.ptw,
      { id: newRowId('ptw'), description: '', type: 'Cold Work', pwtNo: '', pa: '', issued: '', validity: '', status: 'OPEN' },
    ]);
  }
  function removePtw(id: string) {
    update('ptw', form.ptw.filter((r) => r.id !== id));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/daily/${form.date}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hariKe: form.hariKe,
          weather: form.weather,
          manHours: form.manHours,
          nonEffective: form.nonEffective,
          ptw: form.ptw,
          hseInput: form.hseInput,
          activitiesToday: form.activitiesToday,
          activitiesTomorrow: form.activitiesTomorrow,
          planPct: form.planPct,
          actualPct: form.actualPct,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        alert(body.error ?? 'Failed to save');
        return;
      }
      setDirty(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const weekday = new Date(`${form.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{weekday}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <span>Hari ke-</span>
            <input
              type="number"
              value={form.hariKe ?? ''}
              onChange={(e) => update('hariKe', e.target.value ? Number(e.target.value) : null)}
              className="w-16 rounded border border-gray-300 px-2 py-0.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/daily/${form.date}/print`}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-300 ease-ios hover:bg-gray-50 hover:shadow active:scale-[0.97]"
          >
            Print
          </Link>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96] disabled:opacity-50"
          >
            {saving ? 'Saving…' : dirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Weather */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Keadaan Cuaca</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['hujanDeras', 'hujanDerasJam', 'Hujan Deras'],
              ['hujanSedang', 'hujanSedangJam', 'Hujan Sedang'],
              ['berawanMendung', 'berawanMendungJam', 'Berawan / Mendung'],
              ['cerahTerang', 'cerahTerangJam', 'Cerah / Terang'],
            ] as const
          ).map(([checkKey, jamKey, label]) => (
            <label
              key={checkKey}
              className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 transition-colors hover:border-blue-300"
            >
              <input
                type="checkbox"
                checked={form.weather[checkKey]}
                onChange={(e) => updateWeather(checkKey, e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="flex-1 text-sm text-gray-700">{label}</span>
              <input
                type="text"
                placeholder="jam"
                value={form.weather[jamKey]}
                onChange={(e) => updateWeather(jamKey, e.target.value)}
                className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 text-sm text-gray-600">
          <span>Waktu</span>
          <input
            type="time"
            value={form.weather.waktuMulai}
            onChange={(e) => updateWeather('waktuMulai', e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span>s/d</span>
          <input
            type="time"
            value={form.weather.waktuSelesai}
            onChange={(e) => updateWeather('waktuSelesai', e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </section>

      {/* Man Hours */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">1. Man Hours</h2>
          <button onClick={addManHour} className="text-sm text-blue-600 transition-all duration-200 ease-ios hover:text-blue-800 active:scale-[0.96]">
            + Add company
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="px-2 py-2 text-left font-medium">Company</th>
              <th className="px-2 py-2 text-right font-medium">POB Qty</th>
              <th className="px-2 py-2 text-right font-medium">Previous</th>
              <th className="px-2 py-2 text-right font-medium">Today</th>
              <th className="px-2 py-2 text-right font-medium">Total</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {form.manHours.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 transition-colors hover:bg-gray-50">
                <td className="px-2 py-1.5">
                  <input
                    value={row.company}
                    onChange={(e) => updateManHour(row.id, { company: e.target.value })}
                    className="w-full rounded border border-transparent px-1.5 py-1 transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={row.pobQty}
                    onChange={(e) => updateManHour(row.id, { pobQty: Number(e.target.value) || 0 })}
                    className="w-16 rounded border border-transparent px-1.5 py-1 text-right transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={row.previousHours}
                    onChange={(e) => updateManHour(row.id, { previousHours: Number(e.target.value) || 0 })}
                    className="w-20 rounded border border-transparent px-1.5 py-1 text-right transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={row.todayHours}
                    onChange={(e) => updateManHour(row.id, { todayHours: Number(e.target.value) || 0 })}
                    className="w-20 rounded border border-transparent px-1.5 py-1 text-right transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-gray-700">
                  {(row.previousHours + row.todayHours).toLocaleString()}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => removeManHour(row.id)} className="text-gray-300 transition-all duration-200 ease-ios hover:text-red-500 hover:scale-110 active:scale-95">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Non-Effective Working Hours */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Non Effective Working Hours</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="px-2 py-2 text-left font-medium">Cause</th>
              <th className="px-2 py-2 text-right font-medium">Previous</th>
              <th className="px-2 py-2 text-right font-medium">Today</th>
              <th className="px-2 py-2 text-right font-medium">Cumm.</th>
              <th className="px-2 py-2 text-left font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {form.nonEffective.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 transition-colors hover:bg-gray-50">
                <td className="px-2 py-1.5 text-gray-700">{row.cause}</td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={row.previous}
                    onChange={(e) => updateNonEffective(row.id, { previous: Number(e.target.value) || 0 })}
                    className="w-16 rounded border border-transparent px-1.5 py-1 text-right transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={row.today}
                    onChange={(e) => updateNonEffective(row.id, { today: Number(e.target.value) || 0 })}
                    className="w-16 rounded border border-transparent px-1.5 py-1 text-right transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-gray-700">{row.previous + row.today}</td>
                <td className="px-2 py-1.5">
                  <input
                    value={row.remark}
                    onChange={(e) => updateNonEffective(row.id, { remark: e.target.value })}
                    className="w-full rounded border border-transparent px-1.5 py-1 transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Permit to Work */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">2. Permit to Work (PTW)</h2>
          <button onClick={addPtw} className="text-sm text-blue-600 transition-all duration-200 ease-ios hover:text-blue-800 active:scale-[0.96]">
            + Add permit
          </button>
        </div>
        <div className="space-y-3">
          {form.ptw.length === 0 && <p className="text-sm text-gray-400">No permits recorded for this day.</p>}
          {form.ptw.map((row) => (
            <div key={row.id} className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <textarea
                value={row.description}
                onChange={(e) => updatePtw(row.id, { description: e.target.value })}
                placeholder="Description"
                rows={2}
                className="col-span-full rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.type}
                onChange={(e) => updatePtw(row.id, { type: e.target.value })}
                placeholder="Type"
                className="rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.pwtNo}
                onChange={(e) => updatePtw(row.id, { pwtNo: e.target.value })}
                placeholder="PWT No"
                className="rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.pa}
                onChange={(e) => updatePtw(row.id, { pa: e.target.value })}
                placeholder="PA"
                className="rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.status}
                onChange={(e) => updatePtw(row.id, { status: e.target.value })}
                placeholder="Status"
                className="rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={row.issued}
                onChange={(e) => updatePtw(row.id, { issued: e.target.value })}
                className="rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={row.validity}
                onChange={(e) => updatePtw(row.id, { validity: e.target.value })}
                className="rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={() => removePtw(row.id)}
                className="justify-self-start text-xs text-gray-400 transition-colors hover:text-red-500"
              >
                Remove permit
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* HSE Input */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">3. HSE Input</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="px-2 py-2 text-left font-medium">Activity</th>
              <th className="px-2 py-2 text-right font-medium">Previous</th>
              <th className="px-2 py-2 text-right font-medium">Today</th>
              <th className="px-2 py-2 text-right font-medium">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {form.hseInput.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 transition-colors hover:bg-gray-50">
                <td className="px-2 py-1.5 text-gray-700">{row.activity}</td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={row.previous}
                    onChange={(e) => updateHse(row.id, { previous: Number(e.target.value) || 0 })}
                    className="w-16 rounded border border-transparent px-1.5 py-1 text-right transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={row.today}
                    onChange={(e) => updateHse(row.id, { today: Number(e.target.value) || 0 })}
                    className="w-16 rounded border border-transparent px-1.5 py-1 text-right transition-colors hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-gray-700">{row.previous + row.today}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Activities & Plan/Actual */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Daily Activities</h2>
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Today&apos;s Activities
            </h3>
            <textarea
              value={form.activitiesToday}
              onChange={(e) => update('activitiesToday', e.target.value)}
              rows={5}
              placeholder="Describe the activities carried out today…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Tomorrow&apos;s Activities
            </h3>
            <textarea
              value={form.activitiesTomorrow}
              onChange={(e) => update('activitiesTomorrow', e.target.value)}
              rows={5}
              placeholder="Describe the planned activities for tomorrow…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:w-1/2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Plan (%)</label>
            <input
              type="number"
              step="0.01"
              value={form.planPct}
              onChange={(e) => update('planPct', Number(e.target.value) || 0)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Actual (%)</label>
            <input
              type="number"
              step="0.01"
              value={form.actualPct}
              onChange={(e) => update('actualPct', Number(e.target.value) || 0)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
