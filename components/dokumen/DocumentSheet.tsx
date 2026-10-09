'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Clock, Pencil, Send, Trash2, X } from 'lucide-react';

import { deleteDocument, saveDocument, saveStage, setDocumentStatus } from '@/lib/doc-actions';
import type { StatusWhere } from '@/lib/register-status';
import { REPLY_DAYS, baseOfAdded, type DocumentCard, type DocumentStageDetail } from '@/lib/register-shared';
import { CODE_TONE, codeLabel, docRev, mainStagesOf, revAt, stageOf, type RegisterSettings } from '@/lib/register-settings';
import type { DocStage, RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';
import NativeSelect from '@/components/ui/NativeSelect';
import DateField from '@/components/ui/DateField';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { SlideTab } from '@/components/motion/SlideTab';
import { numberTooLong, type NumberingRule } from '@/lib/register-numbering';

/**
 * One document, everything about it, over the list that was not disturbed to
 * get here (4 Oct 2026, variant B of the Data mockups, chosen by the user).
 *
 * THE FRAME IS DATA OVERALL'S, ON PURPOSE: the user asked for the detail to
 * open and close exactly like the activity sheet there, so this is the same
 * shell (`ActivityPanel`): a portal over the page, a 40% scrim, the
 * `.animate-sheet-in/out` keyframes (0.5 s on `--ease-ios`; from the right on a
 * wide screen, from the bottom on a phone, where it can be dragged away), a
 * 27 rem sheet with its left corners rounded. Escape closes; the page behind
 * does not scroll.
 *
 * THE CONTENT IS FLEXIBLE: number, title, discipline, kind, Rev, plan dates,
 * every history entry, PIC and remarks are edited in place, one field at a
 * time, each saved as it is left. A plan date the register needs and does not
 * have is the one thing said in red (the user's "violation" rule: crucial
 * fields remind, in a sentence that starts with a capital).
 */

const fmt = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
const fmtY = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const field =
  'h-10 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-base outline-none transition-colors duration-200 ease-ios ' +
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';
const quiet =
  'w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 outline-none transition-colors duration-200 ease-ios ' +
  'hover:border-border focus-visible:border-ring focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/50';

function handOver(closed: { current: boolean }, onClose: { current: () => void }) {
  if (closed.current) return;
  closed.current = true;
  onClose.current();
}

export function DocumentSheet({
  projectId, register, doc, groups, settings, rule, nextLetter, position, onPrev, onNext, onClose,
}: {
  projectId: string;
  register: RegisterKind;
  doc: DocumentCard;
  /** Every leaf group, for moving the document. */
  groups: { id: string; name: string }[];
  settings: RegisterSettings;
  /** The register's numbering, for the length of each part of a typed number. */
  rule: NumberingRule;
  /** The letter number a send would go out on. */
  nextLetter: string;
  /** "2 of 6 in Instrument & Control". */
  position: { index: number; total: number; group: string };
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
}) {
  const edl = register === 'edl';
  const other = edl ? 'client' : 'vendor';
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const close = () => setClosing(true);
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => handOver(closedRef, onCloseRef), 650);
    return () => window.clearTimeout(t);
  }, [closing]);

  const panelRef = useRef<HTMLDivElement>(null);
  // Read once at mount: this component never renders on the server.
  const [wide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setClosing(true); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [editing, setEditing] = useState<DocStage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noTooLong, setNoTooLong] = useState<string | null>(null);
  const [settingStatus, setSettingStatus] = useState(false);
  const [kindPick, setKindPick] = useState<{ id: string; kind: string } | null>(null);
  /** What a status change would replace, waiting for a yes. */
  const [replacing, setReplacing] = useState<{ target: StatusInput; lines: string[] } | null>(null);

  const run = (task: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const r = await task();
      if (!r.ok) { setError(r.error); setKindPick(null); return; }
      setSavedAt(Date.now());
    });
  };

  const saveDoc = (patch: Partial<{ docNo: string; title: string; kind: string; categoryId: string; revision: string; pic: string; remarks: string }>) =>
    run(() => saveDocument({
      projectId, register, documentId: doc.id,
      docNo: patch.docNo ?? doc.docNo ?? '', title: patch.title ?? doc.title,
      ...patch,
    }));

  const stageRow = (stage: DocStage): DocumentStageDetail | undefined => doc.stages.find((s) => s.stage === stage);
  const saveStageRow = (stage: DocStage, patch: Partial<DocumentStageDetail>) => {
    const s = { ...stageRow(stage), ...patch };
    run(() => saveStage({
      projectId, register, documentId: doc.id, stage,
      sentAt: s.submittedAt ?? '', sentTransmittal: s.submitTransmittal ?? '',
      returnedAt: s.returnedAt ?? '', returnTransmittal: s.returnTransmittal ?? '',
      returnCode: s.returnCode ?? '', planSubmitDate: s.planSubmitDate ?? '',
    }));
  };

  const saveStatus = (t: StatusInput, confirmed: boolean) => {
    setError(null);
    start(async () => {
      const r = await setDocumentStatus({ projectId, register, documentId: doc.id, ...t, confirmed });
      if (!r.ok) {
        if ('confirm' in r) setReplacing({ target: t, lines: r.confirm });
        else setError(r.error);
        return;
      }
      setReplacing(null);
      setSettingStatus(false);
      setSavedAt(Date.now());
    });
  };

  /* --------------------------------------------------------- the state */

  const done = doc.percent >= 100 && !doc.out;
  // Rev follows the register's rule (Setup): the stage it went out at, plus
  // one per resubmission. Never typed here, so it cannot disagree with the issue.
  const rev = docRev(settings, doc.stages, doc.revision);
  const label = (stage: DocStage | null) => (stage ? stageOf(settings, stage).label : '');
  const reached = (stage: DocStage) => Boolean(stageRow(stage)?.submitted || stageRow(stage)?.submittedAt);
  const days = doc.out?.days ?? null;
  const replyDue = doc.out?.since ? addDays(doc.out.since, REPLY_DAYS) : null;
  // The Summary's `waiting`: past the review, and never for a document at 100%.
  const overdueReply = doc.action?.kind === 'waiting';

  let sentence: string;
  if (done) sentence = 'Every stage is through.';
  else if (doc.out) sentence = `With the ${other} since ${fmt(doc.out.since)}: ${label(doc.out.stage)} sent${days !== null ? ` ${days} day${days === 1 ? '' : 's'} ago` : ''}.`;
  else if (doc.returnCode && doc.sendNext) sentence = `Came back ${codeLabel(settings, doc.returnCode)}. Send ${label(doc.sendNext)} next.`;
  else if (doc.sendNext) sentence = `Ready to send ${label(doc.sendNext)}${doc.plannedAt ? `, planned ${fmt(doc.plannedAt)}` : ''}.`;
  else sentence = 'Nothing to send yet.';

  const history = [...doc.stages]
    .filter((s) => s.submitted || s.submittedAt || s.returnedAt)
    .reverse();

  const body = (
    <div className={cn('fixed inset-0 z-50 flex sm:justify-end', closing && 'pointer-events-none')}>
      <div className={cn('absolute inset-0 bg-black/40', closing ? 'animate-scrim-out' : 'animate-scrim-in')} onClick={close} />
      <div
        className={cn('relative mt-auto flex w-full flex-col sm:mt-0 sm:h-full sm:w-[27rem]', closing ? 'animate-sheet-out' : 'animate-sheet-in')}
        onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) handOver(closedRef, onCloseRef); }}
      >
        <m.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={doc.title}
          tabIndex={-1}
          drag={wide ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.4 }}
          onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) close(); }}
          className="relative flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-card shadow-2xl outline-none sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-3xl"
        >
          <div className="flex justify-center pt-2.5 sm:hidden"><div className="h-1 w-10 rounded-full bg-border" /></div>

          {/* ---------------------------------------------------- the head */}
          <div className="border-b border-border/70 px-5 pb-4 pt-2 sm:px-6 sm:pt-4">
            <div className="flex items-center gap-1">
              <input
                defaultValue={doc.docNo ?? ''}
                key={`no-${doc.id}-${doc.docNo}`}
                placeholder="No number yet"
                aria-label="Document number"
                onChange={() => { if (noTooLong) setNoTooLong(null); }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v === (doc.docNo ?? '')) return;
                  // A part longer than Setup allows is refused, said in red, and left in the box to fix.
                  const why = numberTooLong(v, rule);
                  if (why) { setNoTooLong(why); return; }
                  saveDoc({ docNo: v });
                }}
                aria-invalid={noTooLong ? true : undefined}
                className={cn(quiet, '-ml-2 h-8 flex-1 text-[13px] font-medium text-muted-foreground tabular-nums [font-feature-settings:"tnum"_1,"zero"_1]', noTooLong && 'border-bad bg-bad-soft/40 text-bad')}
              />
              <button type="button" aria-label="Delete this document" onClick={() => setConfirmDelete(true)} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-bad-soft hover:text-bad">
                <Trash2 className="h-[18px] w-[18px]" />
              </button>
              <ConfirmDialog
                open={confirmDelete}
                title="Delete this document?"
                message={history.length > 0
                  ? `${doc.title} has been sent. Its stages and send history go with it.`
                  : `${doc.title} will be removed from the register.`}
                confirmLabel="Delete"
                busyLabel="Deleting…"
                busy={pending}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={() => run(async () => {
                  const r = await deleteDocument({ projectId, register, documentId: doc.id });
                  setConfirmDelete(false);
                  if (r.ok) close();
                  return r;
                })}
              />
              <ConfirmDialog
                open={replacing !== null}
                title="This is already recorded"
                message={<>
                  <span className="block">Setting this status replaces:</span>
                  <ul className="mt-1.5 list-disc pl-5">{replacing?.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                </>}
                confirmLabel="Replace"
                busyLabel="Saving…"
                busy={pending}
                onCancel={() => setReplacing(null)}
                onConfirm={() => { if (replacing) saveStatus(replacing.target, true); }}
              />
              <button type="button" aria-label="Close" onClick={close} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
            {noTooLong && (
              <p className="mt-1 flex items-start gap-2 text-[13px] font-medium text-bad">
                <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-bad" />
                <span>{noTooLong} Not saved.</span>
              </p>
            )}
            <textarea
              defaultValue={doc.title}
              key={`t-${doc.id}-${doc.title}`}
              aria-label="Title"
              rows={1}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== doc.title) saveDoc({ title: v }); }}
              className={cn(quiet, '-ml-2 mt-0.5 resize-none py-0.5 text-[21px] font-semibold leading-7 tracking-tight text-foreground [field-sizing:content]')}
            />
            {/* A fixed grid, never a wrapping row: the discipline takes what is
                left and truncates, so a long name never moves Doc/Dwg or Rev. */}
            <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
              <NativeSelect
                value={doc.categoryId}
                aria-label="Discipline"
                onChange={(e) => saveDoc({ categoryId: e.target.value })}
                wrapperClassName="w-full min-w-0"
                className="h-8 min-h-0 w-full truncate rounded-lg border-border bg-card pl-3 text-[12.5px] text-foreground/85 md:text-[12.5px]"
              >
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </NativeSelect>
              <div role="radiogroup" aria-label="Kind" className="flex h-8 items-center rounded-lg border border-border bg-muted p-0.5">
                {(['Doc', 'Dwg'] as const).map((k) => {
                  // The press shows at once; the stored kind only lands after
                  // the round trip, and a toggle that waits for it got pressed twice.
                  const shown = kindPick?.id === doc.id ? kindPick.kind : (doc.kind ?? 'Doc');
                  const on = shown.toLowerCase().startsWith(k.toLowerCase().slice(0, 2));
                  return (
                    <button key={k} type="button" role="radio" aria-checked={on} onClick={() => { if (on) return; setKindPick({ id: doc.id, kind: k }); saveDoc({ kind: k }); }}
                      className={cn('h-full w-12 rounded-md text-xs font-semibold transition-colors duration-200 ease-ios', on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                      {k}
                    </button>
                  );
                })}
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Rev follows the stage and its resubmissions, as set on Setup">
                Rev
                <span className="flex h-8 w-11 items-center justify-center truncate rounded-lg bg-muted px-1 text-[13px] font-semibold text-foreground tabular-nums">{rev ?? '—'}</span>
              </span>
            </div>
          </div>

          {/* ----------------------------------------------------- the body */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 scrollbar-none sm:px-6">
            {/* One card (variant A of the 8 Oct 2026 mockups, his pick): where the
                document is, its three stages in the register's own words and
                colours, and who has it. A stage not sent yet IS its plan date:
                pressing it opens the picker, so there is no second box for it. */}
            <div className="shrink-0 overflow-hidden rounded-2xl border border-border/70 bg-card">
              <div className="p-4">
                <div className="flex items-center gap-2 tabular-nums">
                  <span
                    className={cn(
                      'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold',
                      done ? 'bg-ok-soft text-ok' : overdueReply ? 'bg-bad-soft text-bad' : doc.out ? 'bg-primary-soft text-primary' : 'bg-muted text-foreground/80',
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : doc.out ? <Clock className="h-3.5 w-3.5" /> : null}
                    {done ? 'Done' : doc.out ? `With ${other}${days !== null ? ` · ${days} d` : ''}` : 'With us'}
                  </span>
                  {(doc.stage || rev) && (
                    <span className="ml-auto text-xs font-semibold text-muted-foreground">
                      {[doc.stage && label(doc.stage), rev && `Rev ${rev}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                <p className="mt-2.5 text-[15px] font-semibold leading-snug text-foreground">{sentence}</p>
                {overdueReply && <p className="mt-1.5 text-[13px] font-medium text-bad">The {other} is past the {REPLY_DAYS}-day review. Chase them.</p>}

                <div className="mt-3.5 grid grid-cols-3 gap-x-1.5 gap-y-3 tabular-nums">
                  {mainStagesOf(settings).map((st) => {
                    const s = stageOf(settings, st);
                    const r = stageRow(st);
                    const isReached = reached(st);
                    // Out with the other side: the bar fills as the review window runs.
                    const inReview = doc.out?.stage === st && !r?.returnedAt;
                    const fill = !isReached ? 0 : inReview ? Math.min(1, Math.max(0.1, (days ?? 0) / REPLY_DAYS)) : 1;
                    const plan = r?.planSubmitDate ?? '';
                    const needsPlan = !done && !isReached && !plan;
                    const head = (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
                          <div className="h-full rounded-full" style={{ width: `${fill * 100}%`, background: inReview && overdueReply ? 'var(--bad)' : s.color }} />
                        </div>
                        <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-foreground">
                          {s.label}
                          {r?.returnedAt && r.returnCode && (
                            <span className={cn('rounded px-1 text-[10.5px] leading-4', CODE_TONE[r.returnCode] ?? 'bg-muted')}>{codeLabel(settings, r.returnCode)}</span>
                          )}
                        </div>
                      </>
                    );
                    if (isReached) {
                      return (
                        <div key={st}>
                          {head}
                          <div className="text-[11.5px] leading-4 text-muted-foreground">{r?.returnedAt ? `Back ${fmt(r.returnedAt)}` : `Sent ${fmt(r?.submittedAt ?? null)}`}</div>
                        </div>
                      );
                    }
                    return (
                      <DateField
                        key={st}
                        value={plan}
                        aria-label={`Plan ${s.label} date`}
                        onChange={(v) => { if (v !== plan) saveStageRow(st, { planSubmitDate: v }); }}
                        className="block min-h-11 w-full cursor-pointer text-left"
                      >
                        {head}
                        <div className={cn('text-[11.5px] leading-4', needsPlan ? 'font-semibold text-bad' : 'text-muted-foreground')}>{plan ? `Plan ${fmt(plan)}` : 'Plan needed'}</div>
                      </DateField>
                    );
                  })}
                </div>

                {/* The status is SET, not reached through letters (9 Oct 2026):
                    which stage, and who has it. See lib/register-status.ts. */}
                {settingStatus ? (
                  <StatusForm
                    doc={doc}
                    settings={settings}
                    other={other}
                    nextLetter={nextLetter}
                    busy={pending}
                    onCancel={() => setSettingStatus(false)}
                    onSave={(t) => saveStatus(t, false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setSettingStatus(true)}
                    className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-200 ease-ios hover:bg-primary-hover"
                  >
                    <Send className="h-4 w-4" />Change status
                  </button>
                )}
              </div>

              <div className="flex border-t border-border/70 bg-muted/40">
                <PicRow key={`pic-${doc.id}-${doc.pic}`} value={doc.pic ?? ''} onSave={(pic) => saveDoc({ pic })} />
                {replyDue && (
                  <div className="flex min-h-14 shrink-0 flex-col justify-center border-l border-border/70 px-4 py-2">
                    <span className={cn('text-xs', overdueReply ? 'font-medium text-bad' : 'text-muted-foreground')}>Reply due</span>
                    <span className={cn('text-[13.5px] font-semibold tabular-nums', overdueReply ? 'text-bad' : 'text-foreground')}>{fmtY(replyDue)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* History: newest first, every entry correctable in place. */}
            <div className="border-t border-border/70 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[13.5px] font-semibold text-foreground">History</h3>
                {!done && doc.sendNext && (
                  <button type="button" onClick={() => setEditing(doc.sendNext)} className="h-8 rounded-lg bg-primary-soft px-3 text-xs font-semibold text-primary">
                    + Add an entry
                  </button>
                )}
              </div>
              {editing && !history.some((h) => h.stage === editing) && (
                <StageForm stage={editing} label={label(editing)} row={stageRow(editing)} settings={settings} other={other}
                  onCancel={() => setEditing(null)} onSave={(p) => { saveStageRow(editing, p); setEditing(null); }} />
              )}
              {history.length === 0 && !editing && <p className="text-[13px] text-muted-foreground">Nothing sent yet.</p>}
              <ol className="flex flex-col">
                {history.map((h, i) => (
                  <li key={h.stage} className="relative pb-4 pl-7 last:pb-0">
                    {i < history.length - 1 && <span className="absolute bottom-0 left-[5px] top-[18px] w-0.5 bg-border/70" />}
                    <span className="absolute left-0 top-1 h-3 w-3 rounded-full" style={{ background: stageOf(settings, h.stage).color }} />
                    {editing === h.stage ? (
                      <StageForm stage={h.stage} label={label(h.stage)} row={h} settings={settings} other={other}
                        onCancel={() => setEditing(null)} onSave={(p) => { saveStageRow(h.stage, p); setEditing(null); }} />
                    ) : (
                      <>
                        {h.returnedAt && (
                          <div className="mb-2">
                            <div className="flex min-h-5 items-center gap-2 tabular-nums">
                              <span className="text-[13px] font-semibold text-foreground">Back from {other}</span>
                              {h.returnCode && <span className={cn('rounded-md px-1.5 text-[11px] font-semibold leading-[18px]', CODE_TONE[h.returnCode] ?? 'bg-muted')}>{codeLabel(settings, h.returnCode)}</span>}
                              <span className="ml-auto text-xs text-muted-foreground">{fmtY(h.returnedAt)}</span>
                              <EditButton onClick={() => setEditing(h.stage)} />
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{[h.returnTransmittal, h.waiting !== null ? `${h.waiting} days in review` : null].filter(Boolean).join(' · ')}</p>
                          </div>
                        )}
                        <div className="flex min-h-5 items-center gap-2 tabular-nums">
                          <span className="text-[13px] font-semibold text-foreground">Sent {label(h.stage)}{(revAt(settings, h.stage) ?? doc.revision) ? `, Rev ${revAt(settings, h.stage) ?? doc.revision}` : ''}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{fmtY(h.submittedAt)}</span>
                          {!h.returnedAt && <EditButton onClick={() => setEditing(h.stage)} />}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{h.submitTransmittal ?? 'No letter recorded'}</p>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            <label className="block">
              <span className="text-xs text-muted-foreground">Remarks</span>
              <textarea
                defaultValue={doc.remarks ?? ''}
                key={`rm-${doc.id}-${doc.remarks}`}
                placeholder="Add a note: the comments, who is on it"
                onBlur={(e) => { if (e.target.value.trim() !== (doc.remarks ?? '')) saveDoc({ remarks: e.target.value }); }}
                className={cn(field, 'mt-1 h-auto min-h-12 resize-none py-3 text-left leading-6 md:leading-6 [field-sizing:content]')}
              />
            </label>
            {error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          </div>

          {/* ---------------------------------------------------- the foot */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-t border-border/70 px-5 sm:pl-6 sm:pr-4">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
              {position.index + 1} of {position.total} in {position.group}
            </span>
            <span className="text-xs text-muted-foreground">{pending ? 'Saving…' : savedAt ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-ok" />Saved</span> : null}</span>
            <button type="button" aria-label="Previous document" disabled={!onPrev} onClick={() => onPrev?.()} className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/80 disabled:opacity-40">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Next document" disabled={!onNext} onClick={() => onNext?.()} className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/80 disabled:opacity-40">
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </m.div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/**
 * Who has the document (variant 1 of the 8 Oct 2026 mockups, his pick): a quiet
 * row until pressed, then a real field, selected, with a tick. Enter or the
 * tick saves, so does leaving the field; Esc puts the name back.
 */
function PicRow({ value, onSave }: { value: string; onSave: (pic: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { cancelled.current = false; setEditing(true); }}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left transition-colors duration-200 ease-ios hover:bg-muted/60"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-muted-foreground">PIC</span>
          <span className={cn('truncate text-[13.5px]', shown ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{shown || 'Assign someone'}</span>
        </span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 bg-card px-4 py-2.5">
      <span className="text-xs text-muted-foreground">PIC</span>
      <div className="flex gap-2">
        <input
          ref={input}
          autoFocus
          defaultValue={shown}
          placeholder="Assign someone"
          aria-label="PIC"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
          }}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (!cancelled.current && next !== shown) { setShown(next); onSave(next); }
            setEditing(false);
          }}
          className={cn(field, 'font-semibold')}
        />
        {/* Pressing it blurs the field first, and the blur is what saves. */}
        <button type="button" aria-label="Save PIC" onClick={() => input.current?.blur()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Check className="h-4 w-4" strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Edit this entry" onClick={onClick} className="-mr-1.5 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}

type StatusInput = { stage: DocStage; where: StatusWhere; code: string | null; date: string; letter: string };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** A resubmission belongs to its main stage: RE-IFA is still IFA. */
const mainOf = (s: DocStage | null | undefined): DocStage =>
  !s ? 'IFR' : baseOfAdded(s) ?? (s.includes('IFR') ? 'IFR' : s.includes('IFA') ? 'IFA' : 'AFC');

/**
 * The status, answered as he put it: which stage, and who has it. "With us"
 * takes the code it came back with, or none while it is still being prepared.
 */
function StatusForm({
  doc, settings, other, nextLetter, busy, onSave, onCancel,
}: {
  doc: DocumentCard;
  settings: RegisterSettings;
  other: string;
  nextLetter: string;
  busy: boolean;
  onSave: (t: StatusInput) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<DocStage>(mainOf(doc.out?.stage ?? doc.stage));
  const [where, setWhere] = useState<StatusWhere>(doc.out ? 'them' : 'us');
  const [code, setCode] = useState<string | null>(doc.out ? null : doc.returnCode);
  const [date, setDate] = useState(todayIso);
  const [letter, setLetter] = useState('');
  const name = stageOf(settings, stage).label;
  const dated = where === 'them' || code !== null;
  const said = where === 'them'
    ? `${name} is with the ${other}.`
    : code ? `${name} came back ${codeLabel(settings, code)}.` : `${name} is being prepared, not sent yet.`;
  const cap = 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground';
  const box = 'h-10 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring md:text-sm';
  // Every question is the SAME control, the header's Doc / Dwg toggle: a grey
  // track, equal segments, the picked one blue. Three different shapes (a
  // white track, a blue track, loose chips) read as three screens (9 Oct 2026).
  const toggle = (label: string, id: string, items: { key: string; label: string }[], value: string, pick: (k: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <span className={cap}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex h-10 items-center rounded-lg border border-border bg-muted p-0.5">
        {items.map((it) => {
          const on = it.key === value;
          return (
            <button key={it.key || 'none'} type="button" role="radio" aria-checked={on} onClick={() => pick(it.key)}
              className={cn('relative isolate h-full min-w-0 flex-1 truncate rounded-md px-1.5 text-[13px] font-semibold transition-colors duration-200 ease-ios', on ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {on && <SlideTab id={id} className="rounded-md bg-primary shadow-sm ring-0 dark:ring-0" />}
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="animate-fade-in-up mt-4 flex flex-col gap-3.5 border-t border-border/70 pt-4">
      {toggle('Stage', 'status-stage', mainStagesOf(settings).map((s) => ({ key: s, label: stageOf(settings, s).label })), stage, (k) => setStage(k as DocStage))}
      {toggle('Who has it', 'status-where', [{ key: 'us', label: 'With us' }, { key: 'them', label: `With ${other}` }], where, (k) => {
        setWhere(k as StatusWhere);
        if (k === 'them') setCode(null);
      })}
      {where === 'us' && toggle('Came back with', 'status-code', [{ key: '', label: 'None' }, ...settings.codes], code ?? '', (k) => setCode(k || null))}
      {dated && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={cap}>{where === 'them' ? 'Sent' : 'Back'}</span>
            <DateField value={date} onChange={setDate} placeholder="Date" className={cn(box, 'gap-1.5')} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={cn(cap, 'truncate')}>Letter (optional)</span>
            <input value={letter} onChange={(e) => setLetter(e.target.value)} placeholder={where === 'them' && nextLetter ? nextLetter : 'No.'} className={cn(box, 'px-2 tracking-tight')} />
          </label>
        </div>
      )}
      <p className="text-[13.5px] font-medium text-foreground">{said}</p>
      {/* Two equal halves, Cancel first, as every confirm in the app. */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="btn-cancel h-10 rounded-lg text-sm">Cancel</button>
        <button type="button" disabled={busy || (dated && !date)}
          onClick={() => onSave({ stage, where, code: where === 'us' ? code : null, date: date || todayIso(), letter })}
          className="h-10 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-200 ease-ios hover:bg-primary-hover disabled:opacity-50">
          Save
        </button>
      </div>
    </div>
  );
}

/** One stage's facts, typed in place: when it went, on which letter, when it came back, with what code. */
function StageForm({
  stage, label, row, settings, other, onSave, onCancel,
}: {
  stage: DocStage;
  label: string;
  row: DocumentStageDetail | undefined;
  settings: RegisterSettings;
  other: string;
  onSave: (patch: Partial<DocumentStageDetail>) => void;
  onCancel: () => void;
}) {
  const [sent, setSent] = useState(row?.submittedAt ?? '');
  const [out, setOut] = useState(row?.submitTransmittal ?? '');
  const [back, setBack] = useState(row?.returnedAt ?? '');
  const [inNo, setInNo] = useState(row?.returnTransmittal ?? '');
  const [code, setCode] = useState(row?.returnCode ?? '');
  const needsCode = Boolean(back) && !code;
  const box = 'h-10 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-base text-foreground outline-none focus-visible:border-ring md:text-sm';
  // One-line captions over full-width fields, so the two columns always line up
  // ("Back from client" wrapped on a phone and pushed its field below its pair's).
  const cell = 'flex min-w-0 flex-col gap-1';
  const cap = 'truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground';
  return (
    <div className="animate-fade-in-up mb-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-3">
      <p className="text-[13px] font-semibold text-foreground">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2.5">
        <label className={cell}><span className={cap}>Sent</span><DateField value={sent} onChange={setSent} placeholder="Date" className={cn(box, 'gap-1.5 text-sm md:text-sm')} /></label>
        <label className={cell}><span className={cap}>Letter out</span><input value={out} onChange={(e) => setOut(e.target.value)} placeholder="No." className={cn(box, 'px-2 text-sm tracking-tight md:text-sm')} /></label>
        <label className={cell}><span className={cap} title={`Back from ${other}`}>Back</span><DateField value={back} onChange={setBack} placeholder="Date" clearable className={cn(box, 'gap-1.5 text-sm md:text-sm')} /></label>
        <label className={cell}><span className={cap}>Letter in</span><input value={inNo} onChange={(e) => setInNo(e.target.value)} placeholder="No." className={cn(box, 'px-2 text-sm tracking-tight md:text-sm')} /></label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn('mr-1 text-xs', needsCode ? 'font-medium text-bad' : 'text-muted-foreground')}>{needsCode ? 'Choose a code' : 'Code'}</span>
        {settings.codes.map((c) => (
          <button key={c.key} type="button" aria-pressed={code === c.key} onClick={() => setCode(code === c.key ? '' : c.key)}
            className={cn('h-8 rounded-lg border px-3 text-xs font-semibold', code === c.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground/80')}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-cancel h-9 rounded-lg px-3.5 text-sm">Cancel</button>
        <button
          type="button"
          disabled={needsCode}
          onClick={() => onSave({ submittedAt: sent || null, submitTransmittal: out || null, returnedAt: back || null, returnTransmittal: inNo || null, returnCode: code || null, stage })}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
