'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { saveDocument, saveStage } from '@/lib/doc-actions';
import { STAGE_LABEL, STAGE_ORDER, type DocumentCard } from '@/lib/register-shared';
import type { DocStage, RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

/**
 * A document, open and editable.
 *
 * Everything here is a plain field that saves itself when you leave it — no
 * modes, no selection, no dialog, no save button. The screen this replaced made
 * someone decide whether they were "recording a submission" or "recording a
 * return" before they could correct a date that was simply wrong, which is not
 * how anyone works.
 *
 * Nothing on this component asks for a percentage. Fill in what happened and
 * the figure at the top recomputes itself — that is the whole deal.
 */

const CODES = ['', 'APP', 'AWC', 'RWC'];

/** Only the three that carry weight are shown by default; the rest on request. */
const CORE: DocStage[] = ['IFR', 'IFA', 'AFC'];

const field =
  'h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none ' +
  'transition-colors duration-150 ease-ios focus:border-primary/60';

export function DocumentEditor({
  projectId,
  register,
  doc,
}: {
  projectId: string;
  register: RegisterKind;
  doc: DocumentCard;
}) {
  const [showAll, setShowAll] = useState(
    () => doc.stages.some((s) => !CORE.includes(s.stage) && (s.submitted || s.returnCode)),
  );
  const stages = showAll ? STAGE_ORDER : CORE;

  return (
    <div className="flex flex-col gap-4 border-t bg-muted/30 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <Text
          label="Number"
          value={doc.docNo ?? ''}
          mono
          onSave={(v) => saveDocument({ projectId, register, documentId: doc.id, docNo: v, title: doc.title })}
        />
        <Text
          label="Title"
          value={doc.title}
          onSave={(v) => saveDocument({ projectId, register, documentId: doc.id, docNo: doc.docNo ?? '', title: v })}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-16 pb-1 font-medium">Stage</th>
              <th className="pb-1 font-medium">Sent</th>
              <th className="pb-1 font-medium">Letter</th>
              <th className="pb-1 font-medium">Returned</th>
              <th className="pb-1 font-medium">Letter</th>
              <th className="w-24 pb-1 font-medium">Code</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <StageRow
                key={stage}
                projectId={projectId}
                register={register}
                documentId={doc.id}
                stage={stage}
                row={doc.stages.find((s) => s.stage === stage) ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {showAll ? 'Hide resubmissions' : 'Show RE-IFR, RE-IFA, RE-AFC, AS-BUILT'}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- pieces */

function StageRow({
  projectId,
  register,
  documentId,
  stage,
  row,
}: {
  projectId: string;
  register: RegisterKind;
  documentId: string;
  stage: DocStage;
  row: DocumentCard['stages'][number] | null;
}) {
  const [draft, setDraft] = useState({
    sentAt: row?.submittedAt ?? '',
    sentTransmittal: row?.submitTransmittal ?? '',
    returnedAt: row?.returnedAt ?? '',
    returnTransmittal: row?.returnTransmittal ?? '',
    returnCode: row?.returnCode ?? '',
  });
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server is the truth: after a save the whole route re-renders and the
  // fresh row arrives as a prop. Without this the field would keep showing the
  // draft even when the save was rejected.
  const serverKey = JSON.stringify(row);
  const lastKey = useRef(serverKey);
  useEffect(() => {
    if (lastKey.current === serverKey) return;
    lastKey.current = serverKey;
    setDraft({
      sentAt: row?.submittedAt ?? '',
      sentTransmittal: row?.submitTransmittal ?? '',
      returnedAt: row?.returnedAt ?? '',
      returnTransmittal: row?.returnTransmittal ?? '',
      returnCode: row?.returnCode ?? '',
    });
  }, [serverKey, row]);

  const commit = (next: typeof draft) => {
    setError(null);
    start(async () => {
      const result = await saveStage({ projectId, register, documentId, stage, ...next });
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    });
  };

  const onBlur = (key: keyof typeof draft) => (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === draft[key]) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    commit(next);
  };

  const plan = row?.planSubmitDate ?? null;

  return (
    <tr className="align-middle">
      <td className="pr-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-medium">{STAGE_LABEL[stage]}</span>
          {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {saved && !pending && <Check className="h-3 w-3 text-emerald-600" />}
        </div>
        {plan && <div className="text-[10px] text-muted-foreground">plan {plan}</div>}
        {error && <div className="text-[10px] text-destructive">{error}</div>}
      </td>
      <td className="pr-2">
        <input type="date" defaultValue={draft.sentAt} onBlur={onBlur('sentAt')} className={field} />
      </td>
      <td className="pr-2">
        <input
          defaultValue={draft.sentTransmittal}
          onBlur={onBlur('sentTransmittal')}
          placeholder="T.001"
          className={cn(field, 'font-mono')}
        />
      </td>
      <td className="pr-2">
        <input type="date" defaultValue={draft.returnedAt} onBlur={onBlur('returnedAt')} className={field} />
      </td>
      <td className="pr-2">
        <input
          defaultValue={draft.returnTransmittal}
          onBlur={onBlur('returnTransmittal')}
          placeholder="T.002"
          className={cn(field, 'font-mono')}
        />
      </td>
      <td>
        <select defaultValue={draft.returnCode} onBlur={onBlur('returnCode')} className={field}>
          {CODES.map((c) => (
            <option key={c} value={c}>{c || '—'}</option>
          ))}
        </select>
      </td>
    </tr>
  );
}

function Text({
  label,
  value,
  mono,
  onSave,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string } | { ok: true; changed: number }>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        defaultValue={value}
        onBlur={(e) => {
          if (e.target.value === value) return;
          setError(null);
          const next = e.target.value;
          start(async () => {
            const result = await onSave(next);
            if (!result.ok) setError('error' in result ? (result.error ?? 'Failed') : 'Failed');
          });
        }}
        className={cn(field, mono && 'font-mono', pending && 'opacity-60')}
      />
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </label>
  );
}
