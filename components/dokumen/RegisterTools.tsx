'use client';

import { useRef, useState, useTransition } from 'react';
import { ClipboardPaste, Download, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { importRegisterFile } from '@/lib/doc-actions';
import type { RegisterKind } from '@/lib/schema';

/**
 * Import and export, where the register is actually worked on.
 *
 * The paste screen only ever appears on an EMPTY register, so until these two
 * buttons existed there was no way back into it: a project whose register had
 * been filled once could never be added to from a file again, and next month's
 * revision of the same EDL had nowhere to go.
 *
 * Import goes through the same writer as a paste, so a number that is already
 * here updates its row rather than adding a second one — the reason importing
 * a revision of the same list is safe.
 */
export function RegisterTools({
  projectId, register, clientName, contractorName, onPaste, exportable = true,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
  /** Opens the paste screen over the workbench. Absent on the paste screen itself. */
  onPaste?: () => void;
  /** Off on the paste screen: exporting a register that does not exist yet is an empty file. */
  exportable?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setNote(null);
    start(async () => {
      const form = new FormData();
      form.set('file', file);
      form.set('projectId', projectId);
      form.set('register', register);
      // A file never carries the two sides' names, so what is already on the
      // project is passed straight back — the import must not blank them.
      form.set('clientName', clientName);
      form.set('contractorName', contractorName);

      const result = await importRegisterFile(form);
      setNote(result.ok
        ? { kind: 'ok', text: `${result.changed} document${result.changed === 1 ? '' : 's'} read in` }
        : { kind: 'bad', text: result.error });
      if (input.current) input.current.value = '';
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {note && (
        <span
          role={note.kind === 'bad' ? 'alert' : undefined}
          className={`animate-fade-in-up rounded-full px-2.5 py-1 text-xs font-medium ${
            note.kind === 'ok'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-rose-100 text-rose-800'
          }`}
        >
          {note.text}
        </span>
      )}

      <input
        ref={input}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {onPaste && (
        <Button variant="outline" className="h-11" onClick={onPaste}>
          <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste list
        </Button>
      )}

      <Button
        variant="outline"
        className="h-11"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        {pending ? 'Reading…' : 'Import'}
      </Button>

      {/* A plain link, not a fetch-and-blob: the file is built by a route that
          sets its own filename, and a link is what a phone's browser knows how
          to hand to Files or Drive. */}
      {exportable && (
        <Button variant="outline" className="h-11" asChild>
          <a href={`/api/register/export?register=${register}`} download>
            <Download className="mr-1.5 h-4 w-4" /> Export
          </a>
        </Button>
      )}
    </div>
  );
}
