'use client';

import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { disciplineFor, nextNumber, type NumberingRule } from '@/lib/register-numbering';

/**
 * The numbering rule, behind the builder's "Change" (3 Oct 2026).
 *
 * It used to be a whole first step that stood between a person and their first
 * document, and was the first of the four things named as making the builder
 * "pusing". The builder now starts from the project's initial and this is where
 * it is corrected when the project's drawings say otherwise. Nothing is saved
 * here: the rule travels with the register when the builder saves.
 *
 * Shell copied from ExportExcelDialog: `.dialog-soft` motion, a plain scrim, and
 * focus moved two frames after opening so the card is drawn first.
 */
export default function NumberingDialog({
  open,
  onOpenChange,
  rule,
  headings,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: NumberingRule;
  headings: string[];
  onChange: (rule: NumberingRule) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const later = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const sampleHeading = headings[0] ?? 'GENERAL';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="dialog-soft max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        overlayClassName="scrim-soft bg-black/40 supports-backdrop-filter:backdrop-blur-none"
        ref={contentRef}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          later(() => contentRef.current?.focus({ preventScroll: true }));
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const back = opener.current;
          if (back) later(() => back.focus({ preventScroll: true }));
        }}
      >
        <DialogHeader>
          <DialogTitle>Document numbers</DialogTitle>
          <DialogDescription>
            Project code, heading code, type, sequence. Any single number can still be typed over.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="numbering-prefix">Project code</Label>
          <Input
            id="numbering-prefix"
            className="h-11 w-40 font-mono uppercase"
            value={rule.prefix}
            onChange={(e) => onChange({ ...rule, prefix: e.target.value.toUpperCase() })}
          />
          <p className="text-sm text-muted-foreground">
            For example{' '}
            <span className="font-mono text-foreground">{nextNumber(rule, sampleHeading, 'Drawing', 'Dwg', [])}</span>
          </p>
        </div>

        {headings.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Heading codes</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {headings.map((h) => (
                <label key={h} className="flex min-h-11 items-center gap-3">
                  <Input
                    className="h-11 w-20 font-mono uppercase"
                    value={rule.disciplines[h] ?? disciplineFor(h, rule)}
                    onChange={(e) => onChange({
                      ...rule,
                      disciplines: { ...rule.disciplines, [h]: e.target.value.toUpperCase() },
                    })}
                    aria-label={`Code for ${h}`}
                  />
                  <span className="min-w-0 truncate text-sm">{h}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button className="h-11" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
