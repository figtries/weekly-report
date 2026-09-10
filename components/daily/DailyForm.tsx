'use client';

import { PressLink, pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { ScrollReveal } from '@/components/motion/ScrollReveal';
import { type FormEvent, type FocusEvent, type KeyboardEvent, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { saveDailyAction } from '@/lib/actions';
import SavePdfButton from '@/components/print/SavePdfButton';
import DateField from '@/components/ui/DateField';
import type { DailyReport, HseRow, ManHourRow, NonEffectiveRow, PtwRow } from '@/lib/types';

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

export default function DailyForm({
  report,
  weatherLabels,
}: {
  report: DailyReport;
  /** Keyed by WeatherInfo field name — see lib/catalogs.ts. */
  weatherLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<DailyReport>(report);
  const [saving, startSaveTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Photos are managed by PhotoUploadGrid (rendered outside this form), so the
  // form's own copy goes stale the moment a photo is uploaded. Mirror the saved
  // list from the server-refreshed prop…
  useEffect(() => {
    setForm((prev) => ({ ...prev, photos: report.photos }));
  }, [report.photos]);

  // …and instantly from the grid's upload responses, so printing right after
  // an upload never races the background server refresh.
  useEffect(() => {
    function onPhotosUpdated(e: Event) {
      const detail = (e as CustomEvent).detail as {
        uploadUrl?: string;
        photos?: (string | null)[];
      } | null;
      if (detail?.uploadUrl === `/api/daily/${report.date}/photos` && Array.isArray(detail.photos)) {
        const photos = detail.photos;
        setForm((prev) => ({ ...prev, photos }));
      }
    }
    window.addEventListener('photos-updated', onPhotosUpdated);
    return () => window.removeEventListener('photos-updated', onPhotosUpdated);
  }, [report.date]);

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

  async function persist() {
    const res = await saveDailyAction(form.date, {
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
    });
    if (!res.ok) {
      alert(res.error);
      return false;
    }
    setDirty(false);
    return true;
  }

  function save() {
    startSaveTransition(async () => {
      if (!(await persist())) return;
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
    });
  }

  // The PDF is rendered on the server from what's stored (see lib/pdf.ts), so
  // unsaved edits would silently save as the old numbers — persist first.
  // SavePdfButton calls this before it downloads.
  async function saveBeforePdf() {
    if (!dirty) return true;
    return persist();
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
    {/* The toolbar renders instantly; each card below rises in with a short
        cascade instead of the whole page animating as one slow block. */}
    <div className="space-y-6 print:hidden">
      <div className="flex items-center justify-between mb-4">
        {/* Back names its destination rather than trusting history: a report
            reached by creating it, by a deep link, or by a reload all have a
            different "previous page", and only one of them is the list.

            The click also refreshes before it leaves, which is what puts a
            just-created report in that list. `/daily` gets prefetched by the
            week tabs and by this very link, so without it the payload the
            router already holds can be the one from before the report existed.

            And an unsaved edit gets asked about instead of thrown away: this
            screen commits on Save, not on every keystroke. */}
        <PressLink {...pressMotion}
          href="/daily"
          onClick={(e) => {
            if (dirty && !window.confirm('Leave without saving? Your changes to this report will be lost.')) {
              e.preventDefault();
              return;
            }
            router.refresh();
          }}
          className="inline-flex items-center gap-2 text-muted-foreground transition-colors duration-200 ease-ios hover:text-foreground"
          aria-label="Back to daily reports"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </PressLink>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors duration-200 ease-ios disabled:cursor-default ${
              justSaved
                ? 'bg-emerald-600 text-white shadow-md'
                : dirty
                  ? 'bg-chart-1 text-white hover:bg-chart-1/90 hover:shadow-md'
                  : 'bg-muted text-muted-foreground'
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
          <SavePdfButton
            url={`/api/pdf/daily/${form.date}`}
            filename={`Daily Report ${form.date}.pdf`}
            ariaLabel={dirty ? 'Save your changes, then save the report as PDF' : 'Save Daily Report as PDF'}
            beforeDownload={saveBeforePdf}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm animate-enter">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{weekday}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>Day no.</span>
            <input
              type="number"
              min={1}
              max={7}
              value={form.hariKe ?? 0}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return update('hariKe', null);
                let num = Number(val);
                if (num > 7) num = 7;
                if (num < 1) num = 1;
                update('hariKe', num);
              }}
              onFocus={selectDisplayedZero}
              onInput={(e) => {
                normalizeLeadingZero(e);
                const val = Number(e.currentTarget.value);
                if (val > 7) e.currentTarget.value = '7';
                if (val < 1 && e.currentTarget.value !== '') e.currentTarget.value = '1';
              }}
              onKeyDown={(e) => replaceDisplayedZero(e, (value) => update('hariKe', Math.min(7, value)), 1)}
              className="min-h-11 w-16 rounded border border-input px-2 py-0.5 sm:min-h-0 text-center focus:outline-none focus:ring-2 focus:ring-chart-1"
            />
          </div>
        </div>
      </div>

      {/* Weather */}
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm animate-enter stagger-1">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Weather</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['hujanDeras', 'hujanDerasJam'],
              ['hujanSedang', 'hujanSedangJam'],
              ['berawanMendung', 'berawanMendungJam'],
              ['cerahTerang', 'cerahTerangJam'],
            ] as const
          ).map(([checkKey, jamKey]) => (
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            <label
              key={checkKey}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 transition-colors hover:border-chart-1/40"
            >
              <input
                type="checkbox"
                checked={form.weather[checkKey]}
                onChange={(e) => updateWeather(checkKey, e.target.checked)}
                className="size-5 rounded border-input text-chart-1 focus:ring-chart-1 sm:size-4"
              />
              <span className="flex-1 text-sm text-foreground">{weatherLabels[checkKey] ?? checkKey}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="hrs"
                value={form.weather[jamKey]}
                onChange={(e) => {
                  // Only allow digits and a single decimal point.
                  const cleaned = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
                  updateWeather(jamKey, cleaned);
                }}
                className="min-h-11 w-16 rounded border border-input px-1.5 py-0.5 sm:min-h-0 text-xs focus:outline-none focus:ring-1 focus:ring-chart-1"
              />
            </label>
          ))}
        </div>
        {/* Same card styling as the weather rows above, so the two columns
            stay aligned on any screen width; the labels replace the old
            floating "Time … to …" text. */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-md">
          <label className="rounded-md border border-border px-3 py-2 transition-colors focus-within:border-chart-1 focus-within:ring-1 focus-within:ring-chart-1 hover:border-chart-1/40">
            <span className="mb-0.5 block text-xs font-medium text-muted-foreground">Start time</span>
            <input
              type="time"
              value={form.weather.waktuMulai}
              onChange={(e) => updateWeather('waktuMulai', e.target.value)}
              className="block w-full border-0 bg-transparent p-0 text-sm text-foreground focus:outline-none"
            />
          </label>
          <label className="rounded-md border border-border px-3 py-2 transition-colors focus-within:border-chart-1 focus-within:ring-1 focus-within:ring-chart-1 hover:border-chart-1/40">
            <span className="mb-0.5 block text-xs font-medium text-muted-foreground">End time</span>
            <input
              type="time"
              value={form.weather.waktuSelesai}
              onChange={(e) => updateWeather('waktuSelesai', e.target.value)}
              className="block w-full border-0 bg-transparent p-0 text-sm text-foreground focus:outline-none"
            />
          </label>
        </div>
      </section>

      {/* Man Hours */}
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm animate-enter stagger-2">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">1. Man Hours</h2>
          <m.button {...pressMotion} onClick={addManHour} className="text-sm text-chart-1 transition-colors duration-200 ease-ios hover:text-chart-1">
            + Add company
          </m.button>
        </div>
        <div className="scroll-x-hint overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
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
              <tr key={row.id} className="border-b border-border transition-colors hover:bg-muted/60">
                <td className="px-2 py-1.5">
                  <input
                    value={row.company}
                    onChange={(e) => updateManHour(row.id, { company: e.target.value })}
                    className="min-h-11 w-full rounded border border-input px-1.5 py-1 sm:min-h-0 transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
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
                    className="min-h-11 w-16 rounded border border-input px-1.5 py-1 sm:min-h-0 text-right transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
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
                    className="min-h-11 w-20 rounded border border-input px-1.5 py-1 sm:min-h-0 text-right transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
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
                    className="min-h-11 w-20 rounded border border-input px-1.5 py-1 sm:min-h-0 text-right transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-foreground">
                  {(row.previousHours + row.todayHours).toLocaleString('en-US')}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => removeManHour(row.id)} className="text-muted-foreground/50 transition-all duration-200 ease-ios hover:text-bad hover:scale-110 active:scale-95">
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
      <ScrollReveal>
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Non Effective Working Hours</h2>
        <div className="scroll-x-hint overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium">Cause</th>
              <th className="px-2 py-2 text-right font-medium">Previous</th>
              <th className="px-2 py-2 text-right font-medium">Today</th>
              <th className="px-2 py-2 text-right font-medium">Cumm.</th>
              <th className="px-2 py-2 text-left font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {form.nonEffective.map((row) => (
              <tr key={row.id} className="border-b border-border transition-colors hover:bg-muted/60">
                <td className="px-2 py-1.5 text-foreground">{row.cause}</td>
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
                    className="min-h-11 w-16 rounded border border-input px-1.5 py-1 sm:min-h-0 text-right transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
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
                    className="min-h-11 w-16 rounded border border-input px-1.5 py-1 sm:min-h-0 text-right transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-foreground">{row.previous + row.today}</td>
                <td className="px-2 py-1.5">
                  <input
                    value={row.remark}
                    onChange={(e) => updateNonEffective(row.id, { remark: e.target.value })}
                    className="min-h-11 w-full rounded border border-input px-1.5 py-1 sm:min-h-0 transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
      </ScrollReveal>

      {/* Permit to Work */}
      <ScrollReveal>
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">2. Permit to Work (PTW)</h2>
          <m.button {...pressMotion} onClick={addPtw} className="text-sm text-chart-1 transition-colors duration-200 ease-ios hover:text-chart-1">
            + Add permit
          </m.button>
        </div>
        <div className="space-y-6">
          {form.ptw.length === 0 && <p className="text-sm text-muted-foreground">No permits recorded for this day.</p>}
          {form.ptw.map((row) => (
            <div key={row.id} className="grid grid-cols-1 gap-2 rounded-lg border-2 border-input p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
              <textarea
                value={row.description}
                onChange={(e) => updatePtw(row.id, { description: e.target.value })}
                placeholder="Description"
                rows={2}
                className="col-span-full resize-none rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-chart-1"
              />
              <input
                value={row.type}
                onChange={(e) => updatePtw(row.id, { type: e.target.value })}
                placeholder="Type"
                className="rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-chart-1"
              />
              <input
                value={row.pwtNo}
                onChange={(e) => updatePtw(row.id, { pwtNo: e.target.value })}
                placeholder="PWT No"
                className="rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-chart-1"
              />
              <input
                value={row.pa}
                onChange={(e) => updatePtw(row.id, { pa: e.target.value })}
                placeholder="PA"
                className="rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-chart-1"
              />
              <input
                value={row.status}
                onChange={(e) => updatePtw(row.id, { status: e.target.value })}
                placeholder="Status"
                className="rounded border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-chart-1"
              />
              <DateField
                value={row.issued}
                onChange={(v) => updatePtw(row.id, { issued: v })}
                placeholder="Issued"
                clearable
                className="min-h-11 min-w-0 rounded border border-input bg-card px-2 py-1 sm:min-h-0 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1"
              />
              <DateField
                value={row.validity}
                onChange={(v) => updatePtw(row.id, { validity: v })}
                placeholder="Validity"
                clearable
                className="min-h-11 min-w-0 rounded border border-input bg-card px-2 py-1 sm:min-h-0 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1"
              />
              <button
                onClick={() => removePtw(row.id)}
                className="justify-self-start text-xs text-muted-foreground transition-colors hover:text-bad"
              >
                Remove permit
              </button>
            </div>
          ))}
        </div>
      </section>
      </ScrollReveal>

      {/* HSE Input */}
      <ScrollReveal>
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-foreground">3. HSE Input</h2>
        <div className="scroll-x-hint overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium">Activity</th>
              <th className="px-2 py-2 text-right font-medium">Previous</th>
              <th className="px-2 py-2 text-right font-medium">Today</th>
              <th className="px-2 py-2 text-right font-medium">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {form.hseInput.map((row) => (
              <tr key={row.id} className="border-b border-border transition-colors hover:bg-muted/60">
                <td className="px-2 py-1.5 text-foreground">{row.activity}</td>
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
                    className="min-h-11 w-16 rounded border border-input px-1.5 py-1 sm:min-h-0 text-right transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
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
                    className="min-h-11 w-16 rounded border border-input px-1.5 py-1 sm:min-h-0 text-right transition-colors focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1"
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-foreground">{row.previous + row.today}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
      </ScrollReveal>

      {/* Activities & Plan/Actual */}
      <ScrollReveal>
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Daily Activities</h2>
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="h-2 w-2 rounded-full bg-chart-1" />
              Today&apos;s Activities
            </h3>
            <textarea
              value={form.activitiesToday}
              onChange={(e) => update('activitiesToday', e.target.value)}
              rows={5}
              placeholder="Describe the activities carried out today…"
              className="w-full resize-none rounded-md border border-input px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-chart-1"
            />
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Tomorrow&apos;s Activities
            </h3>
            <textarea
              value={form.activitiesTomorrow}
              onChange={(e) => update('activitiesTomorrow', e.target.value)}
              rows={5}
              placeholder="Describe the planned activities for tomorrow…"
              className="w-full resize-none rounded-md border border-input px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Plan (%)</label>
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
              className="w-full rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chart-1"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Actual (%)</label>
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
              className="w-full rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ok"
            />
          </div>
        </div>
      </section>
      </ScrollReveal>
    </div>
    </>
  );
}
