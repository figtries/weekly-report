'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { CalendarClock, CornerDownLeft, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { DURATION, EASE } from '@/components/motion/Reveal';
import { STAGE_LABEL, isApproved, type DocumentCard } from '@/lib/register-shared';
import { cn } from '@/lib/utils';

/**
 * One document's whole history.
 *
 * This is the part an Excel register can never answer. Its columns are
 * overwritten on every revision, so how many times a drawing went round, which
 * stage it got stuck at, and how long each lap took are all lost the moment the
 * file is saved. Here every submission and every return is a row that stays,
 * which is exactly the material an extension-of-time claim is built from.
 */

const tanggal = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
      })
    : null;

export function DocumentPanel({
  doc,
  asOfDate,
  open,
  onOpenChange,
}: {
  doc: DocumentCard;
  asOfDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const moved = doc.stages.filter((s) => s.submitted);
  const totalWaiting = moved.reduce((a, s) => a + (s.waiting ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug">{doc.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {doc.docNo && <span className="font-mono text-xs">{doc.docNo}</span>}
            {doc.revision && <span className="text-xs">rev {doc.revision}</span>}
            <span className="tabular-nums text-xs">{doc.percent.toFixed(0)}% dari bobot dokumen</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center">
          <Figure label="tahap tercatat" value={String(moved.length)} />
          <Figure label="bolak-balik" value={`${doc.laps}×`} />
          <Figure label="total menunggu" value={`${totalWaiting} hari`} />
        </div>

        <ol className="relative mt-2 flex flex-col gap-4 pl-6">
          <span aria-hidden className="absolute bottom-2 left-[7px] top-2 w-px bg-border" />

          {doc.stages.map((s, i) => {
            const sent = tanggal(s.submittedAt);
            const back = tanggal(s.returnedAt);
            const planned = tanggal(s.planSubmitDate);
            const late = !s.submitted && s.planSubmitDate !== null && s.planSubmitDate < asOfDate;

            return (
              <motion.li
                key={s.stage}
                initial={reduced ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: DURATION, ease: EASE, delay: Math.min(i, 6) * 0.05 }}
                className="relative"
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute -left-6 top-1 size-[15px] rounded-full border-2 border-background',
                    !s.submitted ? 'bg-muted-foreground/30'
                      : isApproved(s.returnCode) ? 'bg-emerald-600'
                      : s.returnCode ? 'bg-rose-600'
                      : 'bg-blue-600',
                  )}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{STAGE_LABEL[s.stage]}</span>
                  {s.returnCode && (
                    <Badge className={cn(
                      'font-normal',
                      isApproved(s.returnCode) ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white',
                    )}>
                      {s.returnCode}
                    </Badge>
                  )}
                  {!s.submitted && (
                    <Badge variant="outline" className={cn('font-normal', late && 'border-amber-600 text-amber-700')}>
                      {late ? 'lewat tanggal rencana' : 'belum dikirim'}
                    </Badge>
                  )}
                </div>

                <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
                  {planned && (
                    <span className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                      dijanjikan {planned}
                    </span>
                  )}
                  {s.submitted && (
                    <span className="flex items-center gap-1.5">
                      <Send className="h-3.5 w-3.5 shrink-0" />
                      dikirim {sent ?? 'tanpa tanggal'}
                      {s.submitTransmittal && <span className="font-mono">· {s.submitTransmittal}</span>}
                    </span>
                  )}
                  {(back || s.returnCode) && (
                    <span className="flex items-center gap-1.5">
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />
                      kembali {back ?? 'tanpa tanggal'}
                      {s.returnTransmittal && <span className="font-mono">· {s.returnTransmittal}</span>}
                      {s.waiting !== null && <span>· {s.waiting} hari</span>}
                    </span>
                  )}
                  {s.submitted && !back && s.waiting !== null && (
                    <span className="text-amber-600">masih di tangan reviewer, {s.waiting} hari</span>
                  )}
                </div>
              </motion.li>
            );
          })}

          {doc.stages.length === 0 && (
            <li className="text-sm text-muted-foreground">
              Belum ada satu pun tahap yang tercatat untuk dokumen ini.
            </li>
          )}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[0.7rem] text-muted-foreground">{label}</p>
    </div>
  );
}
