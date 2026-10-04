'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Pencil, Send, X } from 'lucide-react';

import { deleteDocument, saveDocument, saveStage } from '@/lib/doc-actions';
import { REPLY_DAYS, type DocumentCard, type DocumentStageDetail } from '@/lib/register-shared';
import { CODE_TONE, MAIN_STAGES, codeLabel, docRev, revAt, stageOf, type RegisterSettings } from '@/lib/register-settings';
import type { DocStage, RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

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
  projectId, register, doc, groups, settings, nextLetter, position, onPrev, onNext, onSend, onReply, onClose,
}: {
  projectId: string;
  register: RegisterKind;
  doc: DocumentCard;
  /** Every leaf group, for moving the document. */
  groups: { id: string; name: string }[];
  settings: RegisterSettings;
  /** The letter number a send would go out on. */
  nextLetter: string;
  /** "2 of 6 in Instrument & Control". */
  position: { index: number; total: number; group: string };
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onSend: (doc: DocumentCard, stage: DocStage) => void;
  onReply: (doc: DocumentCard) => void;
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
  const [menu, setMenu] = useState(false);

  const run = (task: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const r = await task();
      if (!r.ok) { setError(r.error); return; }
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

  /* --------------------------------------------------------- the state */

  const done = doc.percent >= 100 && !doc.out;
  // Rev follows the register's rule (Setup): the stage it went out at, plus
  // one per resubmission. Never typed here, so it cannot disagree with the issue.
  const rev = docRev(settings, doc.stages, doc.revision);
  const nextRev = doc.sendNext ? revAt(settings, doc.sendNext) : null;
  const label = (stage: DocStage | null) => (stage ? stageOf(settings, stage).label : '');
  const reached = (stage: DocStage) => Boolean(stageRow(stage)?.submitted || stageRow(stage)?.submittedAt);
  const days = doc.out?.days ?? null;
  const replyDue = doc.out?.since ? addDays(doc.out.since, REPLY_DAYS) : null;
  const overdueReply = days !== null && days > REPLY_DAYS;

  let sentence: string;
  if (done) sentence = 'Done. Every stage is through.';
  else if (doc.out) sentence = `With the ${other} since ${fmt(doc.out.since)}: ${label(doc.out.stage)} sent${days !== null ? ` ${days} day${days === 1 ? '' : 's'} ago` : ''}.`;
  else if (doc.returnCode && doc.sendNext) sentence = `Came back ${codeLabel(settings, doc.returnCode)} — send ${label(doc.sendNext)} next.`;
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
                onBlur={(e) => { if (e.target.value.trim() !== (doc.docNo ?? '')) saveDoc({ docNo: e.target.value }); }}
                className={cn(quiet, '-ml-2 h-8 flex-1 text-[13px] font-medium text-muted-foreground tabular-nums [font-feature-settings:"tnum"_1,"zero"_1]')}
              />
              <div className="relative">
                <button type="button" aria-label="More for this document" aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                  <span className="text-lg leading-none">⋯</span>
                </button>
                {menu && (
                  <div className="animate-fade-in-up absolute right-0 top-10 z-10 w-56 rounded-2xl border bg-card p-1.5 shadow-lg">
                    <button
                      type="button"
                      disabled={history.length > 0}
                      onClick={() => run(async () => {
                        const r = await deleteDocument({ projectId, register, documentId: doc.id });
                        if (r.ok) close();
                        return r;
                      })}
                      className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-bad hover:bg-bad-soft disabled:text-muted-foreground disabled:hover:bg-transparent"
                    >
                      {history.length > 0 ? 'Delete: only before it is sent' : 'Delete this document'}
                    </button>
                  </div>
                )}
              </div>
              <button type="button" aria-label="Close" onClick={close} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
            <textarea
              defaultValue={doc.title}
              key={`t-${doc.id}-${doc.title}`}
              aria-label="Title"
              rows={1}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== doc.title) saveDoc({ title: v }); }}
              className={cn(quiet, '-ml-2 mt-0.5 resize-none py-0.5 text-[21px] font-semibold leading-7 tracking-tight text-foreground [field-sizing:content]')}
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <select
                value={doc.categoryId}
                aria-label="Discipline"
                onChange={(e) => saveDoc({ categoryId: e.target.value })}
                className="h-8 max-w-[14rem] truncate rounded-full border border-border bg-card px-3 text-[12.5px] text-foreground/85 outline-none focus-visible:border-ring"
              >
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <div role="radiogroup" aria-label="Kind" className="flex rounded-full bg-muted p-0.5">
                {(['Doc', 'Dwg'] as const).map((k) => {
                  const on = (doc.kind ?? 'Doc').toLowerCase().startsWith(k.toLowerCase().slice(0, 2));
                  return (
                    <button key={k} type="button" role="radio" aria-checked={on} onClick={() => !on && saveDoc({ kind: k })}
                      className={cn('h-7 rounded-full px-3 text-xs font-semibold transition-colors duration-200 ease-ios', on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
                      {k}
                    </button>
                  );
                })}
              </div>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" title="Rev follows the stage and its resubmissions, as set on Setup">
                Rev
                <span className="flex h-8 min-w-11 items-center justify-center rounded-lg bg-muted px-2 text-[13px] font-semibold text-foreground tabular-nums">{rev ?? '—'}</span>
              </span>
            </div>
          </div>

          {/* ----------------------------------------------------- the body */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 scrollbar-none sm:px-6">
            <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground/80 tabular-nums">
                {doc.stage && <span>{label(doc.stage)}</span>}
                {rev && <><span className="font-normal text-muted-foreground">·</span><span>Rev {rev}</span></>}
                {doc.returnCode && (
                  <span className={cn('rounded-md px-1.5 py-px text-[11px]', CODE_TONE[doc.returnCode] ?? 'bg-muted')}>{codeLabel(settings, doc.returnCode)}</span>
                )}
                <span className={cn('ml-auto font-medium', overdueReply ? 'text-bad' : 'text-muted-foreground')}>
                  {done ? 'Done' : doc.out ? `With ${other}${days !== null ? ` · ${days} d` : ''}` : 'With us'}
                </span>
              </div>
              <p className="mt-2.5 text-[15px] font-medium leading-snug text-foreground">{sentence}</p>
              {overdueReply && <p className="mt-1.5 text-[13px] font-medium text-bad">The {other} is past the {REPLY_DAYS}-day review. Chase them.</p>}
              {!done && (doc.sendNext || doc.out) && (
                <button
                  type="button"
                  onClick={() => (doc.out ? onReply(doc) : onSend(doc, doc.sendNext!))}
                  className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-200 ease-ios hover:bg-primary-hover"
                >
                  {doc.out ? <>Record the {other}&apos;s reply</> : <><Send className="h-4 w-4" />Send {label(doc.sendNext)}{nextRev ? `, Rev ${nextRev}` : ''}</>}
                </button>
              )}
              {!done && doc.sendNext && !doc.out && nextLetter && (
                <p className="mt-2 text-center text-xs text-muted-foreground tabular-nums">Goes out on {nextLetter}</p>
              )}
            </div>

            {/* The three stages, in the register's own words and colours. */}
            <div>
              <div className="flex items-center">
                {MAIN_STAGES.map((st, i) => {
                  const s = stageOf(settings, st);
                  const isReached = reached(st);
                  const isNext = !isReached && (doc.sendNext === st || doc.out?.stage === st || doc.nextStage === st);
                  return (
                    <div key={st} className={cn('flex items-center', i < MAIN_STAGES.length - 1 && 'flex-1')}>
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                        style={{ background: isReached ? s.color : 'var(--card)', borderColor: isReached || isNext ? s.color : 'var(--border)' }}
                      >
                        {isReached && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                      </span>
                      {i < MAIN_STAGES.length - 1 && <span className="mx-1 h-0.5 flex-1 rounded-full" style={{ background: isReached ? s.color : 'var(--border)' }} />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 grid grid-cols-3 text-xs leading-4 tabular-nums">
                {MAIN_STAGES.map((st, i) => {
                  const r = stageRow(st);
                  const isReached = reached(st);
                  const plan = r?.planSubmitDate ?? null;
                  const needsPlan = !done && !isReached && !plan;
                  return (
                    <div key={st} className={cn(i === 1 && 'text-center', i === 2 && 'text-right')}>
                      <div className="font-semibold text-foreground">{label(st)}</div>
                      <div className={cn(needsPlan ? 'font-semibold text-bad' : 'text-muted-foreground')}>
                        {isReached ? (r?.returnedAt ? `Back ${fmt(r.returnedAt)}` : `Sent ${fmt(r?.submittedAt ?? null)}`) : plan ? `Plan ${fmt(plan)}` : 'Plan needed'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* What a document controller fills in: plan dates, PIC, and the reply due. */}
            <div className="grid grid-cols-2 gap-2">
              {MAIN_STAGES.filter((st) => !reached(st)).map((st) => {
                const plan = stageRow(st)?.planSubmitDate ?? '';
                const needs = !done && !plan;
                return (
                  <label key={st} className={cn('flex min-h-[3.25rem] flex-col justify-center rounded-xl border px-3 py-1.5', needs ? 'border-bad/40 bg-bad-soft/60' : 'border-border/70 bg-card')}>
                    <span className={cn('text-xs', needs ? 'font-medium text-bad' : 'text-muted-foreground')}>{needs ? `Plan ${label(st)} date needed` : `Plan ${label(st)}`}</span>
                    <input
                      type="date"
                      defaultValue={plan}
                      key={`p-${doc.id}-${st}-${plan}`}
                      onBlur={(e) => { if (e.target.value !== plan) saveStageRow(st, { planSubmitDate: e.target.value }); }}
                      className="mt-0.5 bg-transparent text-[13.5px] font-semibold text-foreground outline-none"
                    />
                  </label>
                );
              })}
              <label className="flex min-h-[3.25rem] flex-col justify-center rounded-xl border border-border/70 bg-card px-3 py-1.5">
                <span className="text-xs text-muted-foreground">PIC</span>
                <input
                  defaultValue={doc.pic ?? ''}
                  key={`pic-${doc.id}-${doc.pic}`}
                  placeholder="Assign someone"
                  onBlur={(e) => { if (e.target.value.trim() !== (doc.pic ?? '')) saveDoc({ pic: e.target.value }); }}
                  className="mt-0.5 bg-transparent text-[13.5px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              {replyDue && (
                <div className={cn('flex min-h-[3.25rem] flex-col justify-center rounded-xl border px-3 py-1.5', overdueReply ? 'border-bad/40 bg-bad-soft/60' : 'border-border/70 bg-card')}>
                  <span className={cn('text-xs', overdueReply ? 'font-medium text-bad' : 'text-muted-foreground')}>Reply due</span>
                  <span className="mt-0.5 text-[13.5px] font-semibold tabular-nums text-foreground">{fmtY(replyDue)}</span>
                </div>
              )}
            </div>

            {/* History: newest first, every entry correctable in place. */}
            <div className="border-t border-border/70 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[13.5px] font-semibold text-foreground">History</h3>
                {!done && doc.sendNext && (
                  <button type="button" onClick={() => setEditing(doc.sendNext)} className="h-8 rounded-full bg-primary-soft px-3 text-xs font-semibold text-primary">
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
                className={cn(field, 'mt-1 h-auto min-h-12 resize-none py-2.5 [field-sizing:content]')}
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

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Edit this entry" onClick={onClick} className="-mr-1.5 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
      <Pencil className="h-3.5 w-3.5" />
    </button>
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
  const box = 'h-10 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-base outline-none focus-visible:border-ring md:text-sm';
  return (
    <div className="animate-fade-in-up mb-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-3">
      <p className="text-[13px] font-semibold text-foreground">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">Sent<input type="date" value={sent} onChange={(e) => setSent(e.target.value)} className={cn(box, 'mt-1')} /></label>
        <label className="text-xs text-muted-foreground">Letter out<input value={out} onChange={(e) => setOut(e.target.value)} className={cn(box, 'mt-1')} /></label>
        <label className="text-xs text-muted-foreground">Back from {other}<input type="date" value={back} onChange={(e) => setBack(e.target.value)} className={cn(box, 'mt-1')} /></label>
        <label className="text-xs text-muted-foreground">Letter in<input value={inNo} onChange={(e) => setInNo(e.target.value)} className={cn(box, 'mt-1')} /></label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn('mr-1 text-xs', needsCode ? 'font-medium text-bad' : 'text-muted-foreground')}>{needsCode ? 'Choose a code' : 'Code'}</span>
        {settings.codes.map((c) => (
          <button key={c.key} type="button" aria-pressed={code === c.key} onClick={() => setCode(code === c.key ? '' : c.key)}
            className={cn('h-8 rounded-full border px-3 text-xs font-semibold', code === c.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground/80')}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 rounded-full px-3 text-sm text-muted-foreground">Cancel</button>
        <button
          type="button"
          disabled={needsCode}
          onClick={() => onSave({ submittedAt: sent || null, submitTransmittal: out || null, returnedAt: back || null, returnTransmittal: inNo || null, returnCode: code || null, stage })}
          className="h-9 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}
