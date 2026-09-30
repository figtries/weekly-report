'use client';

import { CloudSun } from 'lucide-react';
import type { WeatherInfo } from '@/lib/types';
import { INPUT_CLS, TextField } from '../fields';
import { CardButton, SectionCard, type CardProps } from '../SectionCard';

const SLOTS = [
  ['hujanDeras', 'hujanDerasJam'],
  ['hujanSedang', 'hujanSedangJam'],
  ['berawanMendung', 'berawanMendungJam'],
  ['cerahTerang', 'cerahTerangJam'],
] as const;

export default function WeatherCard({
  report,
  commit,
  state,
  open,
  onToggle,
  labels,
}: CardProps & { labels: Record<string, string> }) {
  const w = report.weather;
  const patch = (p: Partial<WeatherInfo>) => commit({ weather: { ...w, ...p } });
  const picked = SLOTS.filter(([k]) => w[k]).map(([k]) => labels[k] ?? k);
  const summary = picked.length ? `${picked.join(' · ')} · ${w.waktuMulai} to ${w.waktuSelesai}` : 'Not entered yet';

  return (
    <SectionCard
      id="weather"
      icon={<CloudSun className="size-[18px]" />}
      title="Weather"
      summary={summary}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        picked.length === 0 ? (
          <div className="grid w-full grid-cols-2 gap-2">
            {SLOTS.map(([k]) => (
              <CardButton key={k} onClick={() => patch({ [k]: true } as Partial<WeatherInfo>)}>
                {labels[k] ?? k}
              </CardButton>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {SLOTS.map(([k, j]) => (
          <div key={k} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-1.5">
            <input
              type="checkbox"
              aria-label={labels[k] ?? k}
              checked={w[k]}
              onChange={(e) => patch({ [k]: e.target.checked } as Partial<WeatherInfo>)}
              className="size-5 shrink-0 rounded border-input accent-[var(--chart-1)]"
            />
            <span className="flex-1 text-sm text-foreground">{labels[k] ?? k}</span>
            <TextField
              label={`${labels[k] ?? k} hours`}
              placeholder="hrs"
              value={w[j]}
              onCommit={(v) => patch({ [j]: v.replace(/[^0-9.]/g, '') } as Partial<WeatherInfo>)}
              className="w-16 px-2 text-xs"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-muted-foreground">
          Start time
          <input
            type="time"
            value={w.waktuMulai}
            onChange={(e) => patch({ waktuMulai: e.target.value })}
            className={`${INPUT_CLS} mt-1`}
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          End time
          <input
            type="time"
            value={w.waktuSelesai}
            onChange={(e) => patch({ waktuSelesai: e.target.value })}
            className={`${INPUT_CLS} mt-1`}
          />
        </label>
      </div>
    </SectionCard>
  );
}
