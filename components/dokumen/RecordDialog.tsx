'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addDocument, recordReturn, recordSubmission } from '@/lib/doc-actions';
import { STAGE_LABEL, STAGE_ORDER } from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';

/**
 * One dialog, three jobs: send documents out, book them back in, add a new one.
 *
 * The sending form takes a whole transmittal at once because that is what a
 * transmittal is — `T.001` in Gundih's register carries 34 drawings. The number
 * and the date are typed once, the documents were ticked on the screen behind,
 * and one press moves all of them.
 *
 * Every control here is a native `input` or `select` styled with the shadcn
 * classes. That is deliberate: this dialog opens over a list that can hold
 * hundreds of rows, and a phone should not be asked to mount a portal per
 * field. It also means the OS date picker and the OS select wheel — which is
 * what a 55-year-old site engineer already knows how to use.
 */

export type RecordMode = 'submit' | 'return' | 'add';

const RETURN_CODES = [
  { value: 'APP', label: 'APP — approved' },
  { value: 'AWC', label: 'AWC — approved with comments' },
  { value: 'RWC', label: 'RWC — revise with comments' },
];

/** The chain as a controller says it, resubmissions included. */
const SELECTABLE_STAGES = STAGE_ORDER;

const fieldClass =
  'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs ' +
  'outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] ' +
  'focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

export function RecordDialog({
  mode,
  open,
  onOpenChange,
  projectId,
  register,
  categoryId,
  categoryName,
  documentIds,
  documentLabels,
  defaultStage,
  defaultDate,
  onDone,
}: {
  mode: RecordMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  register: RegisterKind;
  categoryId: string;
  categoryName: string;
  documentIds: string[];
  documentLabels: string[];
  defaultStage: string;
  /** The end of the week being reported — where a new record starts. */
  defaultDate: string;
  onDone: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState(defaultStage);
  const [transmittalNo, setTransmittalNo] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [returnCode, setReturnCode] = useState('AWC');
  const [docNo, setDocNo] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('Doc');

  const heading = mode === 'submit' ? 'Record submission'
    : mode === 'return' ? 'Record return'
    : 'Add document';

  const submit = () => {
    setError(null);
    start(async () => {
      const result =
        mode === 'submit'
          ? await recordSubmission({ projectId, register, stage, transmittalNo, date, documentIds })
          : mode === 'return'
            ? await recordReturn({ projectId, register, stage, transmittalNo, date, returnCode, documentIds })
            : await addDocument({ projectId, register, categoryId, docNo, title, kind });

      if (!result.ok) { setError(result.error); return; }
      onOpenChange(false);
      setTransmittalNo(''); setDate(defaultDate); setDocNo(''); setTitle('');
      onDone(
        mode === 'submit' ? `${result.changed} documents recorded as sent`
          : mode === 'return' ? `${result.changed} documents recorded as returned`
          : 'Document added to the register',
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            {mode === 'add'
              ? `Goes into ${categoryName}. The weights move with it — one more document means a bigger denominator.`
              : `${documentIds.length} documents selected in ${categoryName}.`}
          </DialogDescription>
        </DialogHeader>

        {mode !== 'add' && documentLabels.length > 0 && (
          <div className="max-h-28 overflow-y-auto rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            {documentLabels.join(' · ')}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {mode === 'add' ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="doc-title">Document title</Label>
                <Input
                  id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="Single Line Diagram MCC" className="h-11"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="doc-no">Document number</Label>
                  <Input
                    id="doc-no" value={docNo} onChange={(e) => setDocNo(e.target.value)}
                    placeholder="can be left blank" className="h-11 font-mono"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="doc-kind">Kind</Label>
                  <select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={fieldClass}>
                    <option value="Doc">Doc</option>
                    <option value="Dwg">Dwg</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="stage">Stage</Label>
                <select id="stage" value={stage} onChange={(e) => setStage(e.target.value)} className={fieldClass}>
                  {SELECTABLE_STAGES.map((s) => (
                    <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="transmittal">
                    {mode === 'return' ? 'Return' : 'Outgoing'} transmittal no.
                  </Label>
                  <Input
                    id="transmittal" value={transmittalNo} onChange={(e) => setTransmittalNo(e.target.value)}
                    placeholder="T.048" className="h-11 font-mono"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="date">{mode === 'return' ? 'Date received' : 'Date sent'}</Label>
                  <input
                    id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className={fieldClass}
                  />
                </div>
              </div>

              {mode === 'return' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="code">Return code</Label>
                  <select id="code" value={returnCode} onChange={(e) => setReturnCode(e.target.value)} className={fieldClass}>
                    {RETURN_CODES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button className="h-11" onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
