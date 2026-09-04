'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addCategory, renameCategory } from '@/lib/doc-actions';
import type { RegisterKind } from '@/lib/schema';

/**
 * One dialog for two jobs of the same shape: one name, one button.
 *
 * Two separate dialogs would only duplicate identical error handling.
 */
export function CategoryDialog({
  open, onOpenChange, projectId, register, editing, parentId, parentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  register: RegisterKind;
  /** Present = rename; absent = create. */
  editing?: { id: string; name: string };
  parentId: string | null;
  parentName: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(editing?.name ?? '');

  const submit = () => {
    setError(null);
    start(async () => {
      const result = editing
        ? await renameCategory({ projectId, register, categoryId: editing.id, name })
        : await addCategory({ projectId, register, name, parentId });
      if (!result.ok) { setError(result.error); return; }
      setName('');
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Rename group' : 'Add group'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'It keeps its documents.'
              : parentName ? `Inside ${parentName}.` : 'At the top level.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name" className="h-11" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !pending) submit(); }}
          />
          {error && (
            <p
              role="alert"
              className="animate-fade-in-up rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button className="h-11" onClick={submit} disabled={pending || !name.trim()}>
            {pending ? 'Saving…' : editing ? 'Rename' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
