'use client';

import { useState } from 'react';
import { m } from 'framer-motion';
import { ChevronDown, Info, Lock } from 'lucide-react';

import { Expand } from '@/components/motion/Expand';
import { pressMotion } from '@/components/motion/Press';
import { ACCESS_LEVELS, AREAS, ROLES, accessSummary, type Access, type AreaKey, type Role } from '@/lib/roles';
import { cn } from '@/lib/utils';

/**
 * The roles as cards; pressing one opens what it may open, one card at a time.
 *
 * A DRAFT, and it says so above the cards: with no login nothing here can
 * restrict anybody, and a page of access controls that silently did nothing
 * would read as a lock that is already on. Changes live in this component and
 * a reload puts `lib/roles.ts` back. Six cards, so `Expand` per card is within
 * its "a panel a person opened" rule.
 */
export function RolesBoard() {
  const [roles, setRoles] = useState<Role[]>(ROLES);
  const [open, setOpen] = useState<string | null>(null);

  const setAccess = (roleKey: string, area: AreaKey, access: Access) =>
    setRoles((rs) => rs.map((r) => (r.key === roleKey ? { ...r, access: { ...r.access, [area]: access } } : r)));

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-foreground animate-enter stagger-1">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        {/* The gap is a margin, not a space: a text node opening with a space
            after the bold word came back from the server without it, and the
            mismatch threw a hydration error (#418) on every load. */}
        <p>
          <span className="mr-1 font-semibold">Draft.</span>
          {"Changes here aren't saved and don't restrict anyone yet. That comes with login."}
        </p>
      </div>

      <ul className="space-y-3 animate-enter stagger-2">
        {roles.map((role) => {
          const isOpen = open === role.key;
          return (
            <li key={role.key} className="overflow-hidden rounded-lg border bg-card">
              <m.button
                {...pressMotion}
                type="button"
                onClick={() => setOpen(isOpen ? null : role.key)}
                aria-expanded={isOpen}
                className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-ios hover:bg-muted/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-primary">
                  {role.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[15px] font-semibold text-foreground">{role.name}</span>
                    {role.master && (
                      <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                        Controls the app
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{role.duty}</span>
                </span>
                <span className="hidden shrink-0 text-sm font-medium text-foreground sm:block">
                  {accessSummary(role.access)}
                </span>
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-ios',
                    isOpen && 'rotate-180'
                  )}
                  aria-hidden
                />
              </m.button>

              <Expand open={isOpen}>
                <div className="border-t px-4 pb-2 pt-1">
                  <p className="pt-2 text-sm font-medium text-foreground sm:hidden">{accessSummary(role.access)}</p>
                  <ul className="divide-y">
                    {AREAS.map((area) => (
                      <li key={area.key} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{area.label}</span>
                          <span className="block text-xs text-muted-foreground">Edit: {area.edit}</span>
                        </span>
                        {role.master ? (
                          <span className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary sm:min-h-9">
                            <Lock className="size-3.5" aria-hidden />
                            Always Edit
                          </span>
                        ) : (
                          <AccessPicker
                            label={`${role.name}, ${area.label}`}
                            value={role.access[area.key]}
                            onChange={(a) => setAccess(role.key, area.key, a)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </Expand>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** None / View / Edit as three native buttons: seven rows a card, so no Radix per row. */
function AccessPicker({ label, value, onChange }: { label: string; value: Access; onChange: (a: Access) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg border bg-muted/50 p-0.5">
      {ACCESS_LEVELS.map((lvl) => {
        const on = value === lvl.key;
        return (
          <button
            key={lvl.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(lvl.key)}
            className={cn(
              'min-h-11 min-w-14 rounded-md px-3 text-sm transition-colors duration-150 ease-ios active:scale-[0.97] sm:min-h-9',
              on
                ? lvl.key === 'none'
                  ? 'bg-card font-semibold text-foreground shadow-sm'
                  : 'bg-card font-semibold text-primary shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {lvl.label}
          </button>
        );
      })}
    </div>
  );
}
