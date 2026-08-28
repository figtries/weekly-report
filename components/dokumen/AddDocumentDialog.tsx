'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addDocument } from '@/lib/doc-actions';
import type { RegisterKind } from '@/lib/schema';

/**
 * Two fields, because a document only needs two to exist.
 *
 * Its dates and letters are filled in on the row afterwards, where everything
 * else is edited — there is no separate "record" step to learn.
 */
export function AddDocumentDialog({
  open,
  onOpenChange,
  projectId,
  register,
  categoryId,
  categoryName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  register: RegisterKind;
  categoryId: string;
  categoryName: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [docNo, setDocNo] = useState('');
  const [title, setTitle] = useState('');

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await addDocument({ projectId, register, categoryId, docNo, title, kind: 'Doc' });
      if (!result.ok) { setError(result.error); return; }
      setDocNo(''); setTitle('');
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add document</DialogTitle>
          <DialogDescription>Into {categoryName}.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-title">Title</Label>
            <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-11" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-no">Number</Label>
            <Input
              id="new-no" value={docNo} onChange={(e) => setDocNo(e.target.value)}
              placeholder="optional" className="h-11 font-mono"
            />
          </div>
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
          <Button className="h-11" onClick={submit} disabled={pending || !title.trim()}>
            {pending ? 'Saving…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
