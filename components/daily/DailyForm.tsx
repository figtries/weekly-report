'use client';

import { type FormEvent, type FocusEvent, type KeyboardEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DailyReport, HseRow, ManHourRow, NonEffectiveRow, PtwRow, ProjectInfo } from '@/lib/types';
import DailyPrintReport from '@/components/print/DailyPrintReport';

let rowIdCounter = 0;
function newRowId(prefix: string) {
  rowIdCounter += 1;
  return `${prefix}-${Date.now()}-${rowIdCounter}`;
}

function selectDisplayedZero(e: FocusEvent<HTMLInputElement>) {
  if (e.currentTarget.value === '0') {
    e.currentTarget.select();
  }
}

function replaceDisplayedZero(
  e: KeyboardEvent<HTMLInputElement>,
  setValue: (value: number) => void,
  minValue = 0
) {
  if (e.ctrlKey || e.metaKey || e.altKey || !/^\d$/.test(e.key) || e.currentTarget.value !== '0') {
    return;
  }

  e.preventDefault();
  setValue(Math.max(minValue, Number(e.key)));
}

function normalizeLeadingZero(e: FormEvent<HTMLInputElement>) {
  if (/^0\d/.test(e.currentTarget.value)) {
    e.currentTarget.value = String(Number(e.currentTarget.value));
  }
}

export default function DailyForm({ report, project }: { report: DailyReport; project: ProjectInfo }) {
  const router = useRouter();
  const [form, setForm] = useState<DailyReport>(report);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // The A4 print sheet is heavy (two full pages of tables). We only mount it
  // while actually printing — a snapshot of the current form — so it never
  // re-renders on every keystroke during editing.
  const [printData, setPrintData] = useState<DailyReport | null>(null);

  useEffect(() => {
    if (!printData) return;
    let cancelled = false;
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('[data-print-sheet] img'));
    Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            })
      )
    ).then(() => {
      if (cancelled) return;
      window.print();
      setPrintData(null);
    });
    return () => {
      cancelled = true;
    };
  }, [printData]);

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
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
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
    <>
    <div className="animate-fade-in-up space-y-6 print:hidden">
      <button
        onClick={() => router.push('/daily')}
        className="mb-4 inline-flex items-center gap-2 text-gray-600 transition-all duration-200 ease-ios hover:text-gray-900 active:scale-[0.96]"
        aria-label="Back to daily reports"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-medium">Back</span>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">{weekday}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <span>Day no.</span>
            <input
              type="number"
              min={1}
              value={form.hariKe ?? 0}
              onChange={(e) => update('hariKe', e.target.value ? Math.max(1, Number(e.target.value)) : null)}
              onFocus={selectDisplayedZero}
              onInput={normalizeLeadingZero}
              onKeyDown={(e) => replaceDisplayedZero(e, (value) => update('hariKe', value), 1)}
              className="w-16 rounded border border-gray-300 px-2 py-0.5 text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPrintData(form)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96]"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M5 2.75C5 1.784 5.784 1 6.75 1h6.5c.966 0 1.75.784 1.75 1.75v3.552c.377.046.752.097 1.126.153A2.212 2.212 0 0118 8.653v4.097A2.25 2.25 0 0115.75 15h-.241l.305 1.984A1.75 1.75 0 0114.084 19H5.915a1.75 1.75 0 01-1.729-2.016L4.492 15H4.25A2.25 2.25 0 012 12.75V8.653c0-1.082.775-2.034 1.874-2.198.374-.056.75-.107 1.126-.153V2.75zm1.5 3.212c1.158-.083 2.325-.126 3.5-.126s2.342.043 3.5.126V2.75a.25.25 0 00-.25-.25h-6.5a.25.25 0 00-.25.25v3.212zM5.457 15l-.427 2.775a.25.25 0 00.247.225h9.446a.25.25 0 00.247-.225L14.543 15H5.457z"
                clipRule="evenodd"
              />
            </svg>
            Print
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-all duration-300 ease-ios active:scale-[0.96] disabled:cursor-default ${
              justSaved
                ? 'bg-emerald-600 text-white shadow-md'
                : dirty
                  ? 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
                  : 'bg-gray-100 text-gray-400'
            }`}
          >
            {saving ? (
              'Saving…'
            ) : justSaved ? (
              <>
                <svg className="h-4 w-4 animate-fade-in-up" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M5 10.5l3.5 3.5L15 6.5"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Saved!
              </>
            ) : dirty ? (
              'Save Changes'
            ) : (
              'Saved'
            )}
          </button>
        </div>
      </div>

      {/* Weather */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Weather</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['hujanDeras', 'hujanDerasJam', 'Heavy Rain'],
              ['hujanSedang', 'hujanSedangJam', 'Moderate Rain'],
              ['berawanMendung', 'berawanMendungJam', 'Cloudy / Overcast'],
              ['cerahTerang', 'cerahTerangJam', 'Clear / Sunny'],
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
                placeholder="hrs"
                value={form.weather[jamKey]}
                onChange={(e) => updateWeather(jamKey, e.target.value)}
                className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 text-sm text-gray-600">
          <span>Time</span>
          <input
            type="time"
            value={form.weather.waktuMulai}
            onChange={(e) => updateWeather('waktuMulai', e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-center">to</span>
          <input
            type="time"
            value={form.weather.waktuSelesai}
            onChange={(e) => updateWeather('waktuSelesai', e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </section>

      {/* Man Hours */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">1. Man Hours</h2>
          <button onClick={addManHour} className="text-sm text-blue-600 transition-all duration-200 ease-ios hover:text-blue-800 active:scale-[0.96]">
            + Add company
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
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
                    className="w-full rounded border border-gray-300 px-1.5 py-1 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    min={0}
                    value={row.pobQty}
                    onChange={(e) => updateManHour(row.id, { pobQty: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => { if (e.target.value === '') updateManHour(row.id, { pobQty: 0 }); }}
                    onFocus={selectDisplayedZero}
                    onInput={normalizeLeadingZero}
                    onKeyDown={(e) => replaceDisplayedZero(e, (value) => updateManHour(row.id, { pobQty: value }))}
                    className="w-16 rounded border border-gray-300 px-1.5 py-1 text-right transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    min={0}
                    value={row.previousHours}
                    onChange={(e) => updateManHour(row.id, { previousHours: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => { if (e.target.value === '') updateManHour(row.id, { previousHours: 0 }); }}
                    onFocus={selectDisplayedZero}
                    onInput={normalizeLeadingZero}
                    onKeyDown={(e) => replaceDisplayedZero(e, (value) => updateManHour(row.id, { previousHours: value }))}
                    className="w-20 rounded border border-gray-300 px-1.5 py-1 text-right transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    min={0}
                    value={row.todayHours}
                    onChange={(e) => updateManHour(row.id, { todayHours: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => { if (e.target.value === '') updateManHour(row.id, { todayHours: 0 }); }}
                    onFocus={selectDisplayedZero}
                    onInput={normalizeLeadingZero}
                    onKeyDown={(e) => replaceDisplayedZero(e, (value) => updateManHour(row.id, { todayHours: value }))}
                    className="w-20 rounded border border-gray-300 px-1.5 py-1 text-right transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-gray-700">
                  {(row.previousHours + row.todayHours).toLocaleString('en-US')}
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
        </div>
      </section>

      {/* Non-Effective Working Hours */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Non Effective Working Hours</h2>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
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
                    min={0}
                    value={row.previous}
                    onChange={(e) => updateNonEffective(row.id, { previous: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => { if (e.target.value === '') updateNonEffective(row.id, { previous: 0 }); }}
                    onFocus={selectDisplayedZero}
                    onInput={normalizeLeadingZero}
                    onKeyDown={(e) => replaceDisplayedZero(e, (value) => updateNonEffective(row.id, { previous: value }))}
                    className="w-16 rounded border border-gray-300 px-1.5 py-1 text-right transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    min={0}
                    value={row.today}
                    onChange={(e) => updateNonEffective(row.id, { today: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => { if (e.target.value === '') updateNonEffective(row.id, { today: 0 }); }}
                    onFocus={selectDisplayedZero}
                    onInput={normalizeLeadingZero}
                    onKeyDown={(e) => replaceDisplayedZero(e, (value) => updateNonEffective(row.id, { today: value }))}
                    className="w-16 rounded border border-gray-300 px-1.5 py-1 text-right transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-gray-700">{row.previous + row.today}</td>
                <td className="px-2 py-1.5">
                  <input
                    value={row.remark}
                    onChange={(e) => updateNonEffective(row.id, { remark: e.target.value })}
                    className="w-full rounded border border-gray-300 px-1.5 py-1 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {/* Permit to Work */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">2. Permit to Work (PTW)</h2>
          <button onClick={addPtw} className="text-sm text-blue-600 transition-all duration-200 ease-ios hover:text-blue-800 active:scale-[0.96]">
            + Add permit
          </button>
        </div>
        <div className="space-y-6">
          {form.ptw.length === 0 && <p className="text-sm text-gray-400">No permits recorded for this day.</p>}
          {form.ptw.map((row) => (
            <div key={row.id} className="grid grid-cols-1 gap-2 rounded-lg border-2 border-gray-300 p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              <textarea
                value={row.description}
                onChange={(e) => updatePtw(row.id, { description: e.target.value })}
                placeholder="Description"
                rows={2}
                className="col-span-full resize-none rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.type}
                onChange={(e) => updatePtw(row.id, { type: e.target.value })}
                placeholder="Type"
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.pwtNo}
                onChange={(e) => updatePtw(row.id, { pwtNo: e.target.value })}
                placeholder="PWT No"
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.pa}
                onChange={(e) => updatePtw(row.id, { pa: e.target.value })}
                placeholder="PA"
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={row.status}
                onChange={(e) => updatePtw(row.id, { status: e.target.value })}
                placeholder="Status"
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={row.issued}
                onChange={(e) => updatePtw(row.id, { issued: e.target.value })}
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={row.validity}
                onChange={(e) => updatePtw(row.id, { validity: e.target.value })}
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
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
      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">3. HSE Input</h2>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
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
                    min={0}
                    value={row.previous}
                    onChange={(e) => updateHse(row.id, { previous: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => { if (e.target.value === '') updateHse(row.id, { previous: 0 }); }}
                    onFocus={selectDisplayedZero}
                    onInput={normalizeLeadingZero}
                    onKeyDown={(e) => replaceDisplayedZero(e, (value) => updateHse(row.id, { previous: value }))}
                    className="w-16 rounded border border-gray-300 px-1.5 py-1 text-right transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    min={0}
                    value={row.today}
                    onChange={(e) => updateHse(row.id, { today: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })}
                    onBlur={(e) => { if (e.target.value === '') updateHse(row.id, { today: 0 }); }}
                    onFocus={selectDisplayedZero}
                    onInput={normalizeLeadingZero}
                    onKeyDown={(e) => replaceDisplayedZero(e, (value) => updateHse(row.id, { today: value }))}
                    className="w-16 rounded border border-gray-300 px-1.5 py-1 text-right transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-gray-700">{row.previous + row.today}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {/* Activities & Plan/Actual */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
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
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Plan (%)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.planPct}
              onChange={(e) => update('planPct', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
              onBlur={(e) => { if (e.target.value === '') update('planPct', 0); }}
              onFocus={selectDisplayedZero}
              onInput={normalizeLeadingZero}
              onKeyDown={(e) => replaceDisplayedZero(e, (value) => update('planPct', value))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Actual (%)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.actualPct}
              onChange={(e) => update('actualPct', e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
              onBlur={(e) => { if (e.target.value === '') update('actualPct', 0); }}
              onFocus={selectDisplayedZero}
              onInput={normalizeLeadingZero}
              onKeyDown={(e) => replaceDisplayedZero(e, (value) => update('actualPct', value))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
      </section>
    </div>

    {/* Mounted only while printing (snapshot of the current form). Pressing
       Print jumps straight to the browser dialog, and it unmounts afterward so
       it never weighs down editing. */}
    {printData && (
      <div data-print-sheet className="hidden print:block">
        <DailyPrintReport project={project} report={printData} />
      </div>
    )}
    </>
  );
}
