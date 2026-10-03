'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { saveDocument, saveStage } from '@/lib/doc-actions';
import { STAGE_LABEL, STAGE_ORDER, buildJourney, type DocumentCard } from '@/lib/register-shared';
import type { DocStage, RegisterKind } from '@/lib/schema';
import NativeSelect from '@/components/ui/NativeSelect';
import { cn } from '@/lib/utils';

import { DocumentJourney } from './DocumentJourney';

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

/**
 * APP closes a stage; anything else means it came back for comment and is still
 * holding construction up. It is the only field here that is a judgement rather
 * than a fact, which is why it is a short list and not free text.
 */
const CODES = ['', 'APP', 'AWC', 'RWC'];

/** Only the three that carry weight are shown by default; the rest on request. */
const CORE: DocStage[] = ['IFR', 'IFA', 'AFC'];

/**
 * The same metrics `Input` and `NativeSelect` use, so the six controls on a
 * stage row share one height, one corner radius and one focus ring. It used to
 * be `h-10 rounded-md` with its own focus colour, which put this table half a
 * step out of the app on every count.
 */
const field =
  'h-8 min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 ' +
  'text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 ' +
  'focus-visible:ring-ring/50 sm:min-h-0 md:text-sm dark:bg-input/30';

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
      {/* What happened leads; correcting it follows. You open a document to
          find out where it got stuck, not to type — and this used to be a
          separate Log tab that made you go and look for it. */}
      <DocumentJourney
        laps={buildJourney(doc.stages)}
        overdue={doc.overdue}
        returnOpen={doc.returnCode !== null}
      />

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

      {/* One block per stage, two lines each (3 Oct 2026). The plan date joined
          the row and a single line of seven fields left the letter numbers
          about forty pixels: "MRB-TRM-O-(" was all anyone could read. */}
      <div className="flex flex-col gap-2">
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
    planSubmitDate: row?.planSubmitDate ?? '',
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
      planSubmitDate: row?.planSubmitDate ?? '',
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

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex min-h-9 items-center gap-2">
        <span className="font-mono text-xs font-semibold">{STAGE_LABEL[stage]}</span>
        {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {saved && !pending && <Check className="h-3 w-3 text-emerald-600" />}
        {error && <span className="text-[11px] text-destructive">{error}</span>}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Plan
          <input
            type="date"
            defaultValue={draft.planSubmitDate}
            onBlur={onBlur('planSubmitDate')}
            aria-label={`${STAGE_LABEL[stage]} planned date`}
            className={cn(field, 'w-[9.5rem] text-foreground')}
          />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_8.5rem_minmax(0,1fr)_5rem]">
        <Field label="Sent">
          <input type="date" defaultValue={draft.sentAt} onBlur={onBlur('sentAt')} className={field} />
        </Field>
        <Field label="Letter out">
          <input
            defaultValue={draft.sentTransmittal}
            onBlur={onBlur('sentTransmittal')}
            placeholder="T.001"
            className={cn(field, 'px-2 font-mono tracking-tight sm:px-2.5 md:text-[13px] md:tracking-normal')}
          />
        </Field>
        <Field label="Returned">
          <input type="date" defaultValue={draft.returnedAt} onBlur={onBlur('returnedAt')} className={field} />
        </Field>
        <Field label="Letter back">
          <input
            defaultValue={draft.returnTransmittal}
            onBlur={onBlur('returnTransmittal')}
            placeholder="T.002"
            className={cn(field, 'px-2 font-mono tracking-tight sm:px-2.5 md:text-[13px] md:tracking-normal')}
          />
        </Field>
        <Field label="Code">
          <NativeSelect
            defaultValue={draft.returnCode}
            onBlur={onBlur('returnCode')}
            aria-label="Return code"
          >
            {CODES.map((c) => (
              <option key={c} value={c}>{c || 'None'}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </div>
  );
}

/** A field with its name over it, so every box says what it holds on a phone too. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
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
