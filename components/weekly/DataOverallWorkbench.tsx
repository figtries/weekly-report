'use client';

import { PressLink, pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import Link from 'next/link';
import { memo, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  markNoProgressAction,
  saveFieldProgressAction,
  saveWeekUpdatesAction,
  setProgressMethodAction,
} from '@/lib/actions';
import type { RollupNode } from '@/lib/rollup';
import type { Worklist, WorklistEntry } from '@/lib/worklist';
import type { ChangeLogEntry, LeafSnapshot, ProgressMethod } from '@/lib/types';
import { hasRealQuantity, methodOf, totalQty } from '@/lib/progress';
import { Swap } from '@/components/motion/Swap';
import TruncatedName from '@/components/ui/TruncatedName';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * A pending change to one leaf.
 *
 * Three of these four fields are three different ways of saying the same
 * thing, because an item is measured ONE way: `cumProgressPct` is a typed
 * percent, `qtyDone` is a counted quantity, `milestonesDone` is a ticked
 * ladder. Which one a card offers is decided by `methodOf(item)`, never by the
 * user picking a screen — that choice is what the old separate "Field Input"
 * tab made people make every week, for no benefit.
 */
interface EditState {
  cumProgressPct?: number;
  planPct?: number;
  qtyDone?: number;
  milestonesDone?: string[];
}

/** The percent an item has reached, read from whatever it is measured by. */
function pctOf(node: RollupNode, edit: EditState | undefined, snap: LeafSnapshot | undefined) {
  const method = methodOf(node);
  if (method === 'qty') {
    const total = totalQty(node);
    const done = edit?.qtyDone ?? snap?.qtyDone ?? 0;
    return total > 0 ? clamp(round2((done / total) * 100)) : 0;
  }
  if (method === 'milestone') {
    const ms = node.milestones ?? [];
    const total = ms.reduce((sum, m) => sum + m.weight, 0);
    if (!total) return 0;
    const done = edit?.milestonesDone ?? snap?.milestonesDone ?? [];
    return clamp(round2((ms.filter((m) => done.includes(m.id)).reduce((sum, m) => sum + m.weight, 0) / total) * 100));
  }
  return null;
}

const METHOD_LABEL: Record<ProgressMethod, string> = {
  qty: 'A counted quantity',
  milestone: 'A ladder of milestones',
  lumpsum: 'A percent typed by hand',
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
const clamp = (v: number) => Math.max(0, Math.min(100, v));

function isMilestone(n: RollupNode): boolean {
  return n.children.length === 0 && n.bobot === 0;
}

function planPctOf(n: RollupNode): number {
  return n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0;
}

function flattenAll(roots: RollupNode[]): RollupNode[] {
  const out: RollupNode[] = [];
  const visit = (n: RollupNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

function visibleChildren(n: RollupNode): RollupNode[] {
  return n.children.filter((c) => !isMilestone(c));
}

function leafCount(n: RollupNode): number {
  return flattenAll([n]).filter((x) => x.children.length === 0 && !isMilestone(x)).length;
}

/** "+5" adds, "-3" subtracts, "62.5" sets. Comma decimals accepted. */
function parseInput(raw: string, current: number): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return 0;
  if (s.startsWith('+') || s.startsWith('-')) {
    const delta = parseFloat(s);
    if (Number.isNaN(delta)) return null;
    return clamp(round2(current + delta));
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return clamp(round2(n));
}

/** Width of a value in `ch`, so the stepper's input can shrink-wrap it. Tabular
 *  figures are all exactly 1ch, but the decimal separator is not — counting it
 *  as a full digit left the number sitting off-centre next to its "%". */
function chWidth(s: string): number {
  let w = 0;
  for (const c of s) w += c === '.' || c === ',' ? 0.45 : 1;
  return Math.max(1, w);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

// Self-contained ticker — only this tiny span re-renders every minute,
// not the entire Workbench.
function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span suppressHydrationWarning className={className}>
      {timeAgo(iso)}
    </span>
  );
}

/**
 * Human status — words first, numbers second. Every colour comes from this one
 * place so they can never drift out of sync:
 *
 *   100%              → Done            · green chip
 *   at or above plan  → On track        · green chip
 *   behind by ≤ 7.5%  → Slightly behind · amber chip
 *   behind by > 7.5%  → Needs attention · red chip
 *   not started       → Not started     · grey chip
 */
function statusOf(cum: number, plan: number) {
  // The ring draws HOW MUCH is done, so it stays the measurement blue and only
  // turns green once there is nothing left to measure. The chip beside it is
  // what carries the verdict. Values are the --chart-*/--ok/--bad/--warn
  // tokens; this is an inline SVG stroke, which cannot take a class.
  const ring = { done: '#10b981', running: '#3b82f6', idle: '#cbd5e1' };
  if (cum >= 99.95)
    return { label: 'Done', chip: 'bg-ok-soft text-ok', ring: ring.done, ringText: '#047857', bar: 'bg-chart-3' };
  if (cum <= 0.05 && plan <= 0.05)
    return { label: 'Not started', chip: 'bg-muted text-muted-foreground', ring: ring.idle, ringText: '#64748b', bar: 'bg-chart-5/45' };
  const gap = cum - plan;
  if (gap >= -1)
    return { label: 'On track', chip: 'bg-ok-soft text-ok', ring: ring.running, ringText: '#1d4ed8', bar: 'bg-chart-1' };
  if (gap >= -7.5)
    return { label: 'Slightly behind', chip: 'bg-warn-soft text-warn', ring: ring.running, ringText: '#1d4ed8', bar: 'bg-chart-1' };
  return { label: 'Needs attention', chip: 'bg-bad-soft text-bad', ring: ring.running, ringText: '#1d4ed8', bar: 'bg-chart-1' };
}

function gapText(cum: number, plan: number): { text: string; cls: string } {
  const gap = round2(cum - plan);
  if (Math.abs(gap) < 0.05) return { text: 'On plan', cls: 'text-muted-foreground' };
  if (gap >= -1 && gap < 0) return { text: 'Nearly on plan', cls: 'text-muted-foreground' };
  if (gap < 0) return { text: `${Math.abs(gap).toFixed(1)}% behind`, cls: 'text-bad' };
  return { text: `${gap.toFixed(1)}% ahead`, cls: 'text-ok' };
}

/* The behind/ahead verdict, in its status colour. From sm up
 * it stays inline at the end of the meta line; on phones it moves to its own
 * bottom row instead of wrapping mid-sentence. Mirrors Detail Progress. */
function GapInline({ cum, plan }: { cum: number; plan: number }) {
  const gap = gapText(cum, plan);
  return <span className={`hidden font-semibold sm:inline ${gap.cls}`}> · {gap.text}</span>;
}

function GapBottomRow({ cum, plan, className = 'mt-1' }: { cum: number; plan: number; className?: string }) {
  const gap = gapText(cum, plan);
  return <div className={`text-[12px] font-semibold sm:hidden ${gap.cls} ${className}`}>{gap.text}</div>;
}

export default function DataOverallWorkbench({
  roots,
  week,
  recentChanges,
  snapshots,
  worklist,
}: {
  roots: RollupNode[];
  week: number;
  recentChanges: ChangeLogEntry[];
  /** Stored evidence per leaf — the quantities and ticks behind a percentage. */
  snapshots: Record<string, LeafSnapshot | undefined>;
  /** What the schedule says is due this week. See lib/worklist.ts. */
  worklist: Worklist;
}) {
  const flatAll = useMemo(() => flattenAll(roots), [roots]);
  // With a single umbrella root, the SPK contracts underneath are the real
  // top-level "folders" users think in.
  const homeNodes = useMemo(
    () => (roots.length === 1 ? visibleChildren(roots[0]) : roots.filter((r) => !isMilestone(r))),
    [roots]
  );
  const pathBase = roots.length === 1 ? 1 : 0;

  const [path, setPath] = useState<RollupNode[]>([]);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const [levelKey, setLevelKey] = useState(0);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, { cum?: string; plan?: string }>>({});
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());
  const [saving, startSaveTransition] = useTransition();
  const [switching, startSwitchTransition] = useTransition();
  // Set while an item is being moved to quantity mode but has no real total.
  const [askQty, setAskQty] = useState<{ node: RollupNode; total: string; unit: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [barLeaving, setBarLeaving] = useState(false);
  const [query, setQuery] = useState('');
  const [showLog, setShowLog] = useState(false);
  /**
   * 'queue' is this week's due items, 'browse' is the full 285-row drill-down.
   *
   * Queue is the default wherever the project has dates, because the drill-down
   * cannot answer "what do I have to do today" — it shows every contract
   * equally and leaves the filtering to the person. Browse stays one tap away
   * and unchanged; nothing was taken out, it just stopped being the front door.
   */
  const [mode, setMode] = useState<'queue' | 'browse'>(
    worklist.hasSchedule ? 'queue' : 'browse'
  );
  const [showDone, setShowDone] = useState(false);
  /** Set when an autosave fails, so it stops retrying and the bar offers Retry. */
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  /** Leaves whose "no progress" write is in flight — the card shows it at once. */
  const [markingNone, setMarkingNone] = useState<Set<string>>(new Set());
  const logPanelRef = useRef<HTMLDivElement>(null);
  const logToggleRef = useRef<HTMLButtonElement>(null);
  const logListRef = useRef<HTMLDivElement>(null);
  // True while the log list still has rows below the fold. Drives the bottom
  // fade: a hard edge slices the next row in half and reads as the panel being
  // cut off rather than scrollable.
  const [logMore, setLogMore] = useState(false);
  // Whether the list can scroll at all. `overscroll-contain` on a list whose
  // rows already fit swallows the swipe and refuses to pass it to the page, so
  // the floating panel felt frozen — every drag on it did nothing. Containment
  // is only worth it once there is something inside to scroll.
  const [logScrollable, setLogScrollable] = useState(false);
  // Phone-only cap on the whole panel, measured against the live viewport.
  const [logMaxH, setLogMaxH] = useState<string | undefined>(undefined);

  // On phones the log floats over the page, so a tap outside has to dismiss it —
  // an overlay you can only close from the control that opened it feels stuck.
  // Desktop keeps the inline accordion, where tapping away closing it would be
  // surprising.
  useEffect(() => {
    if (!showLog) return;
    if (window.matchMedia('(min-width: 640px)').matches) return;
    // The dismissing tap must not also activate whatever sits under the panel —
    // tapping an activity card to close would otherwise navigate into it, which
    // looks like the panel glitching away. Swallow that one click.
    let swallowNextClick = false;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (logPanelRef.current?.contains(target) || logToggleRef.current?.contains(target)) return;
      swallowNextClick = true;
      setShowLog(false);
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowNextClick) return;
      swallowNextClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [showLog]);

  // Re-measure the log list whenever it opens: the fade only belongs there when
  // rows actually continue past the bottom edge.
  useEffect(() => {
    if (!showLog) return;
    const el = logListRef.current;
    if (!el) return;
    const measure = () => {
      setLogMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
      // 32px, not a hair over zero: a list hiding half a row can barely move,
      // so containing the swipe there still reads as a dead panel.
      setLogScrollable(el.scrollHeight - el.clientHeight > 32);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showLog]);

  // Bound the floating panel to what's actually on screen. The panel opens
  // partway down the page, so a height measured in viewport units alone ran its
  // last rows off the bottom — and because the overlay sits in a zero-height
  // slot the page can't scroll down to them, so those rows were unreachable and
  // the panel read as "won't scroll". Measure from the toggle it hangs off
  // (stable — the panel itself is mid-transition at this point) and leave the
  // rest of the screen to the list. Desktop keeps its static max-height.
  useEffect(() => {
    if (!showLog) return;
    const measure = () => {
      if (window.matchMedia('(min-width: 640px)').matches) {
        setLogMaxH(undefined);
        return;
      }
      const anchor = logToggleRef.current?.getBoundingClientRect().bottom ?? 0;
      // 12px is the panel's own top margin, 16px the breathing room below it.
      setLogMaxH(`${Math.max(200, window.innerHeight - anchor - 12 - 16)}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [showLog]);

  // Re-resolve path nodes after router.refresh() delivers fresh rollups —
  // stale node objects would otherwise keep showing pre-save numbers. Each
  // entry must be a child of the previous one; anything else (e.g. the same
  // node pushed twice by a double-click) is dropped.
  const currentPath = useMemo(() => {
    const resolved: RollupNode[] = [];
    let container = homeNodes;
    for (const p of path) {
      const fresh = container.find((n) => n.id === p.id);
      if (!fresh) continue;
      resolved.push(fresh);
      container = fresh.children;
    }
    return resolved;
  }, [path, homeNodes]);

  const currentNode = currentPath.length ? currentPath[currentPath.length - 1] : null;
  const currentNodes = currentNode ? visibleChildren(currentNode) : homeNodes;
  const dirtyCount = Object.keys(edits).length;

  function navigateInto(node: RollupNode) {
    setDirection('fwd');
    setPath((prev) => (prev[prev.length - 1]?.id === node.id ? prev : [...prev, node]));
    setLevelKey((k) => k + 1);
  }

  function goBack() {
    setDirection('back');
    setPath((prev) => prev.slice(0, -1));
    setLevelKey((k) => k + 1);
  }

  function goToLevel(index: number) {
    // index = -1 means home
    setDirection('back');
    setPath((prev) => prev.slice(0, index + 1));
    setLevelKey((k) => k + 1);
  }

  function jumpToLeaf(leaf: RollupNode) {
    const byChild = new Map<string, RollupNode>();
    flatAll.forEach((p) => p.children.forEach((c) => byChild.set(c.id, p)));
    const chain: RollupNode[] = [];
    let cur = byChild.get(leaf.id);
    while (cur) {
      chain.unshift(cur);
      cur = byChild.get(cur.id);
    }
    setDirection('fwd');
    setPath(chain.slice(pathBase));
    setQuery('');
    setLevelKey((k) => k + 1);
  }

  // Escape = back one level (matches the "folder" mental model).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && path.length && !query) goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [path.length, query]);

  const todayStart = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }, []);

  const sortedLog = useMemo(
    () => [...recentChanges].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [recentChanges]
  );

  // Single source of truth for "today": the update pill, the New badges and
  // the history divider all read from this one filtered list, so the pill
  // number always matches the entries shown in the Change history panel.
  const todayLog = useMemo(
    () => sortedLog.filter((c) => new Date(c.at).getTime() >= todayStart),
    [sortedLog, todayStart]
  );
  const todayCount = todayLog.length;

  const recentIds = useMemo(() => new Set(todayLog.map((c) => c.leafId)), [todayLog]);

  function currentCum(node: RollupNode): number {
    return round2(edits[node.id]?.cumProgressPct ?? node.curProgressPct);
  }
  function currentPlan(node: RollupNode): number {
    return round2(edits[node.id]?.planPct ?? planPctOf(node));
  }

  function setEdit(id: string, patch: EditState) {
    if (justSaved && !saving) {
      setJustSaved(false);
      setBarLeaving(false);
    }

    setEdits((prev) => {
      const merged = { ...prev[id], ...patch };
      const node = flatAll.find((n) => n.id === id);
      if (node) {
        const cumSame =
          merged.cumProgressPct === undefined || round2(merged.cumProgressPct) === round2(node.curProgressPct);
        const planSame = merged.planPct === undefined || round2(merged.planPct) === round2(planPctOf(node));
        if (cumSame && planSame) {
          const next = { ...prev };
          delete next[id];
          return next;
        }
      }
      return { ...prev, [id]: merged };
    });
  }

  function adjustCum(node: RollupNode, delta: number) {
    const next = clamp(round2(currentCum(node) + delta));
    setEdit(node.id, { cumProgressPct: next });
    setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], cum: String(next) } }));
  }

  function discardAll() {
    setEdits({});
    setRawInputs({});
    setSaveFailed(null);
  }

  /**
   * Autosave.
   *
   * A week gets filled in one card at a time, often on a phone in a site
   * office, and under the batch Save button every card typed so far was lost to
   * a locked screen or a closed tab. Each settled edit now writes on its own.
   * The bottom bar survives as the status line, and the manual Save stays for
   * anyone who would rather commit deliberately.
   *
   * 1200ms is measured against the fastest control on a card: the quantity
   * stepper moves a twentieth of the total per tap, so a 0→100 sweep is twenty
   * taps, and a shorter delay turns one gesture into twenty writes.
   */
  useEffect(() => {
    if (dirtyCount === 0 || saving || saveFailed) return;
    const t = setTimeout(() => save(true), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, dirtyCount, saving, saveFailed]);

  /**
   * "Looked at it, nothing moved this week."
   *
   * Optimistic on purpose — the card leaves the queue on the tap rather than
   * after the round trip, because the whole point of the control is to get an
   * item out of the way. `markingNone` only ever ADDS to what the server
   * already says, so a refresh landing mid-flight cannot contradict it.
   */
  function markNone(node: RollupNode) {
    setMarkingNone((prev) => new Set(prev).add(node.id));
    startSaveTransition(async () => {
      const res = await markNoProgressAction(week, [node.id]);
      if (!res.ok) {
        alert(res.error);
        setMarkingNone((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      }
    });
  }

  /**
   * @param silent autosave. A failed autosave must not alert — it would fire
   * again on the next tick and trap the page behind a loop of dialogs — so it
   * parks the reason in `saveFailed`, which stops the retry and turns the
   * bottom bar into "Couldn't save · Retry".
   */
  function save(silent = false) {
    if (!dirtyCount || saving) return;
    setJustSaved(false);
    setBarLeaving(false);
    const report = (msg: string) => {
      if (silent) setSaveFailed(msg);
      else alert(msg);
    };
    startSaveTransition(async () => {
      // Typed percents and plan targets go through one action; counted
      // quantities and ticked milestones go through the other, because for
      // those the EVIDENCE is what is stored and the percentage is derived
      // from it (see AGENTS.md, "Progress has one origin"). One Save button
      // covers both — the person filling this in should never have to know
      // which of the two their item uses.
      const updates: Record<string, { cumProgressPct?: number; targetWF?: number }> = {};
      const evidence: { leafId: string; qtyDone?: number; milestonesDone?: string[] }[] = [];
      for (const [id, patch] of Object.entries(edits)) {
        const node = flatAll.find((n) => n.id === id);
        if (!node) continue;
        if (patch.qtyDone !== undefined || patch.milestonesDone !== undefined) {
          evidence.push({ leafId: id, qtyDone: patch.qtyDone, milestonesDone: patch.milestonesDone });
        }
        if (patch.cumProgressPct === undefined && patch.planPct === undefined) continue;
        updates[id] = {};
        if (patch.cumProgressPct !== undefined) updates[id].cumProgressPct = patch.cumProgressPct;
        if (patch.planPct !== undefined) updates[id].targetWF = (node.bobot * patch.planPct) / 100;
      }
      if (evidence.length) {
        const res = await saveFieldProgressAction(week, evidence);
        if (!res.ok) {
          report(res.error ?? 'Could not save');
          return;
        }
      }
      if (Object.keys(updates).length) {
        const res = await saveWeekUpdatesAction(week, updates);
        if (!res.ok) {
          report(res.error ?? 'Could not save');
          return;
        }
      }
      setSaveFailed(null);
      // Drop the transient typing buffer, but KEEP `edits` in place as an
      // optimistic overlay. The reconcile effect below removes each edit once
      // the action's refresh delivers matching server data — so the number
      // never flickers back to its pre-save value ("kesave lalu balik lagi").
      setRawInputs({});
      setJustSaved(true);
    });
  }

  /**
   * Change how an item is measured.
   *
   * Quantity mode needs a REAL total. `vol: 1, satuan: 'Ls'` is how every
   * seeded item is stored and it passes a naive `vol > 0` check, so switching
   * one of those to quantity silently invents a total of 1 — see AGENTS.md.
   * Ask instead.
   */
  function switchMethod(node: RollupNode, method: ProgressMethod) {
    if (method === methodOf(node)) return;
    if (method === 'qty' && !hasRealQuantity(node)) {
      setAskQty({ node, total: '', unit: '' });
      return;
    }
    startSwitchTransition(async () => {
      const res = await setProgressMethodAction(node.id, method);
      if (!res.ok) alert(res.error);
    });
  }

  function confirmQty() {
    if (!askQty) return;
    const total = Number(askQty.total.replace(',', '.'));
    if (!Number.isFinite(total) || total <= 0 || !askQty.unit.trim()) return;
    const node = askQty.node;
    const unit = askQty.unit.trim();
    setAskQty(null);
    startSwitchTransition(async () => {
      const res = await setProgressMethodAction(node.id, 'qty', { vol: total, satuan: unit });
      if (!res.ok) alert(res.error);
    });
  }

  // "Saved ✓" toast timeline: hold the green confirmation briefly, then
  // play the slide-out before unmounting — so the bar never blinks away.
  useEffect(() => {
    if (!justSaved) return;
    const leave = setTimeout(() => setBarLeaving(true), 900);
    const done = setTimeout(() => {
      setJustSaved(false);
      setBarLeaving(false);
    }, 1140);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
    };
  }, [justSaved]);

  // A fresh edit made while the "saved" toast is still up brings the
  // unsaved-changes bar straight back.
  useEffect(() => {
    if (dirtyCount > 0 && justSaved && !saving) {
      setJustSaved(false);
      setBarLeaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyCount]);

  // After router.refresh() lands fresh rollups, clear any pending edit that now
  // matches the server. This is what actually ends the "belum disimpan" state —
  // doing it here (instead of immediately in save()) keeps the displayed value
  // steady across the save round-trip.
  useEffect(() => {
    setEdits((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      let changed = false;
      const next: Record<string, EditState> = {};
      for (const id of ids) {
        const node = flatAll.find((n) => n.id === id);
        if (!node) {
          next[id] = prev[id];
          continue;
        }
        const e = prev[id];
        const snap = snapshots[id];
        const cumSame = e.cumProgressPct === undefined || round2(e.cumProgressPct) === round2(node.curProgressPct);
        const planSame = e.planPct === undefined || round2(e.planPct) === round2(planPctOf(node));
        const qtySame = e.qtyDone === undefined || e.qtyDone === (snap?.qtyDone ?? 0);
        const msSame =
          e.milestonesDone === undefined ||
          sameIds(e.milestonesDone, snap?.milestonesDone ?? []);
        if (cumSame && planSame && qtySame && msSame) changed = true; // matched server → drop it
        else next[id] = prev[id];
      }
      return changed ? next : prev;
    });
  }, [flatAll, snapshots]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return flatAll
      .filter((n) => n.children.length === 0 && !isMilestone(n) && n.deskripsi.toLowerCase().includes(q))
      .slice(0, 20);
  }, [flatAll, query]);

  const ancestorsOf = useMemo(() => {
    const byChild = new Map<string, RollupNode>();
    flatAll.forEach((p) => p.children.forEach((c) => byChild.set(c.id, p)));
    return (id: string): RollupNode[] => {
      const chain: RollupNode[] = [];
      let cur = byChild.get(id);
      while (cur) {
        chain.unshift(cur);
        cur = byChild.get(cur.id);
      }
      return chain.slice(pathBase);
    };
  }, [flatAll, pathBase]);

  // An item marked "no progress" leaves the queue on the tap. This only ever
  // moves things from due to done, so a server refresh landing mid-flight
  // agrees with it rather than fighting it.
  const queueDue = useMemo(
    () => worklist.due.filter((e) => !markingNone.has(e.node.id)),
    [worklist.due, markingNone]
  );
  const queueDone = useMemo(
    () => [...worklist.done, ...worklist.due.filter((e) => markingNone.has(e.node.id))],
    [worklist.done, worklist.due, markingNone]
  );
  const queueTotal = queueDue.length + queueDone.length;

  const leafProps = {
    week,
    askQty,
    setAskQty,
    confirmQty,
    recentIds,
    recentChanges,
    edits,
    rawInputs,
    detailOpen,
    snapshots,
    onSwitchMethod: switchMethod,
    switching,
    currentCum,
    currentPlan,
    setEdit,
    setRawInputs,
    adjustCum,
    toggleDetail: (id: string) =>
      setDetailOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };

  return (
    <div>
      {/* Top bar: search + today's changes — mirrors the 4-column stat grid
         above so the search lines up under Plan→This Week and the update pill
         sits under Deviation. */}
      <div className="grid grid-cols-1 gap-2 sm:gap-4 lg:grid-cols-4">
        <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border bg-card ring-1 ring-foreground/10 px-3 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-shadow focus-within:shadow-md lg:col-span-3">
          <svg className="h-[18px] w-[18px] shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search an activity…"
            className="w-full border-none bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery('')} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground" aria-label="Clear search">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          ref={logToggleRef}
          onClick={() => setShowLog((v) => !v)}
          disabled={recentChanges.length === 0}
          className={`flex w-full items-center gap-2.5 rounded-2xl border bg-white px-3 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-[border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-expo)] lg:col-span-1 ${
            recentChanges.length > 0
              ? 'cursor-pointer hover:border-border hover:shadow-md active:scale-[0.98]'
              : 'cursor-default'
          } ${showLog ? 'ring-2 ring-chart-1/40' : 'border-border'}`}
        >
          {/* Dot sits in an 18px slot so its text starts at the exact same x as
             the search input's text (which leads with an 18px magnifier). */}
          <span className="flex w-[18px] shrink-0 items-center justify-center">
            <span suppressHydrationWarning className={`h-2 w-2 rounded-full ${todayCount > 0 ? 'bg-ok' : 'bg-muted-foreground/40'}`} />
          </span>
          {/* "Today" is the viewer's local midnight, which the server can't
             know — suppress the one-off SSR/client text mismatch. */}
          <span suppressHydrationWarning className="flex-1 text-left text-[14px] text-muted-foreground">
            {todayCount > 0 ? (
              <><span className="font-semibold text-foreground">{todayCount} {todayCount === 1 ? 'update' : 'updates'}</span> today</>
            ) : (
              'No updates today yet'
            )}
          </span>
          {recentChanges.length > 0 && (
            <span className="ml-auto text-[12px] text-muted-foreground sm:hidden">View</span>
          )}
          {recentChanges.length > 0 && (
            <svg
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300"
              style={{ transform: showLog ? 'rotate(180deg)' : 'rotate(0deg)' }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>
      </div>

      {/* Change log panel.
         PHONES GET AN OVERLAY, DESKTOP KEEPS THE INLINE ACCORDION. The height
         animation (grid-template-rows 0fr→1fr) has to relayout everything below
         the panel on every frame; a phone can't hold 60fps doing that with a
         week of log rows, which is why this opened smoothly on desktop and
         crawled on mobile no matter how the easing was tuned. On mobile the
         panel is absolutely positioned in a zero-height slot, so opening moves
         NOTHING — only opacity and transform change, both composited.
         The top margin stays inside the animated box: toggling it outside
         snapped 12px into place while the height was still easing. */}
      <div className="relative sm:static">
        <div
          ref={logPanelRef}
          // Fade + lift only, no scale: scaling a 650px panel resamples every
          // glyph inside it for the whole animation, which reads as the text
          // going soft and snapping back — exactly the kind of "glitch" this
          // panel is not allowed to have.
          className={`absolute inset-x-0 top-0 z-40 transition-[opacity,transform] duration-300 [transition-timing-function:var(--ease-out-expo)] sm:static sm:z-auto sm:grid sm:translate-y-0 sm:opacity-100 sm:transition-[grid-template-rows] sm:duration-[280ms] ${
            showLog
              ? 'translate-y-0 opacity-100 sm:[grid-template-rows:1fr]'
              : 'pointer-events-none -translate-y-2 opacity-0 sm:pointer-events-auto sm:[grid-template-rows:0fr]'
          }`}
          aria-hidden={!showLog}
        >
          {/* On phones the overlay carries the page colour and a 12px shelf below
             the card, so the activity cards it floats over don't butt straight
             against its bottom edge — desktop gets that gap for free from the
             next block's own top margin. `overflow-hidden` is only the desktop
             accordion's clip; keeping it on mobile also chopped off the panel's
             drop shadow, which is what made the edge look severed. */}
          <div className="bg-muted/50 pb-3 sm:bg-transparent sm:overflow-hidden sm:pb-0 sm:[contain:layout_paint]">
            {/* The card clips its own corners: without this the scrolling list
               paints square over the bottom rounding. */}
            <div
              className="mt-3 flex flex-col overflow-hidden rounded-2xl border bg-card ring-1 ring-foreground/10 shadow-xl sm:shadow-sm"
              style={logMaxH ? { maxHeight: logMaxH } : undefined}
            >
            <div className="flex shrink-0 flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3.5">
              <div className="text-[14px] font-semibold text-foreground">Change history · Week {week}</div>
              <div suppressHydrationWarning className="text-[12px] text-muted-foreground">
                {todayCount > 0 && <span className="font-medium text-ok">{todayCount} today · </span>}
                {sortedLog.length} {sortedLog.length === 1 ? 'update' : 'updates'} recorded
              </div>
            </div>
            <div
              ref={logListRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                setLogMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
                setLogScrollable(el.scrollHeight - el.clientHeight > 32);
              }}
              // `touch-action: pan-y` claims the vertical drag for this list up
              // front; without it the first swipe on the floating panel could be
              // interpreted as a page gesture and the list felt locked.
              // The list takes whatever the capped card has left over — hence
              // min-h-0, without which a flex child refuses to shrink below its
              // content and the cap does nothing.
              className={`min-h-0 flex-1 touch-pan-y overflow-y-auto divide-y divide-border sm:max-h-96 sm:flex-none ${
                logScrollable ? 'overscroll-contain' : 'overscroll-auto'
              }`}
              // Fade the last few pixels only while there is more to reach, so a
              // half-row reads as "keep scrolling" instead of a cut. At the
              // bottom the mask lifts and the final row sits flush on the corner.
              style={
                logMore
                  ? {
                      maskImage: 'linear-gradient(to bottom, #000 calc(100% - 40px), transparent)',
                      WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 40px), transparent)',
                    }
                  : undefined
              }
            >
              {sortedLog.map((c, i) => {
                const leaf = flatAll.find((n) => n.id === c.leafId);
                const delta = round2(c.newValue - c.oldValue);
                const isToday = new Date(c.at).getTime() >= todayStart;
                const showDivider = i > 0 && isTodayAt(sortedLog[i - 1].at, todayStart) && !isToday;
                return (
                  <div key={c.id}>
                    {showDivider && (
                      <div className="bg-muted/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Earlier
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (leaf) {
                          jumpToLeaf(leaf);
                          setShowLog(false);
                        }
                      }}
                      disabled={!leaf}
                      // NO content-visibility here. Rows measure 104px but the
                      // intrinsic-size placeholder was 76px, so every row that
                      // skipped rendering shrank the list by 28px — the list
                      // resized under the fade and that was the close "glitch".
                      // The overlay already removed the need for it.
                      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-chart-1/5 disabled:pointer-events-none"
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                          delta > 0 ? 'bg-ok-soft text-ok' : delta < 0 ? 'bg-bad-soft text-bad' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'}
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* The two lines carry different things on each width.
                           Phones: the Actual/Plan tag ends the name line and the
                           timestamp drops to the numbers line, so the right edge
                           reads tag-then-time down the column. Desktop keeps the
                           timestamp up top and the tag leading the numbers —
                           there is room for it there and that layout was fine.
                           Each right-hand item is `h-5 items-center`, which is
                           the tag's own height: without a shared box the tag and
                           the time sat on their own text baselines and the
                           column looked a pixel or two out. */}
                        <span className="flex h-5 items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {leaf?.deskripsi ?? 'Activity not found'}
                          </span>
                          <span suppressHydrationWarning className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{timeAgo(c.at)}</span>
                          <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:hidden ${
                            c.field === 'cumProgressPct' ? 'bg-chart-1/10 text-chart-1' : 'bg-chart-2/10 text-chart-2'
                          }`}>
                            {c.field === 'cumProgressPct' ? 'Actual' : 'Plan'}
                          </span>
                        </span>
                        <span className="mt-1 flex h-5 items-center gap-1.5 text-[12px] text-muted-foreground">
                          <span className={`hidden items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:inline-flex ${
                            c.field === 'cumProgressPct' ? 'bg-chart-1/10 text-chart-1' : 'bg-chart-2/10 text-chart-2'
                          }`}>
                            {c.field === 'cumProgressPct' ? 'Actual' : 'Plan'}
                          </span>
                          <span className="font-medium tabular-nums text-foreground">{c.oldValue.toFixed(1)}%</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium tabular-nums text-foreground">{c.newValue.toFixed(1)}%</span>
                          <span className={`font-semibold tabular-nums ${delta > 0 ? 'text-ok' : delta < 0 ? 'text-bad' : 'text-muted-foreground'}`}>
                            ({delta > 0 ? '+' : ''}{delta.toFixed(1)}%)
                          </span>
                          <span suppressHydrationWarning className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground sm:hidden">{timeAgo(c.at)}</span>
                          {/* On phones the chevron rides the timestamp's line
                             rather than sitting in a column of its own. That is
                             what puts the tag above it flush to the same right
                             edge — give the chevron its own column and it pushes
                             both lines left of itself, and the tag stops short. */}
                          {leaf && (
                            <svg className="h-4 w-4 shrink-0 text-muted-foreground/60 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </span>
                      </span>
                      {leaf && (
                        <svg className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground/60 sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
              {sortedLog.length === 0 && (
                <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">No updates recorded this week yet.</div>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search results replace the browser */}
      {searchResults ? (
        <div className="mt-3 space-y-2.5 animate-fade-in">
          <div className="px-1 text-[13px] text-muted-foreground">
            {searchResults.length === 0
              ? 'No matching activities.'
              : `${searchResults.length} ${searchResults.length === 1 ? 'activity' : 'activities'} found`}
          </div>
          {searchResults.map((leaf) => (
            <div key={leaf.id} className="animate-fade-in-up">
              <button
                onClick={() => jumpToLeaf(leaf)}
                className="mb-1 flex items-center gap-1.5 px-1 text-[12px] text-muted-foreground hover:text-chart-1"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                {ancestorsOf(leaf.id).map((a) => shortName(a.deskripsi)).join(' › ') || 'Top level'}
                <span className="text-chart-1">· open folder</span>
              </button>
              <LeafCard node={leaf} {...leafProps} />
            </div>
          ))}
        </div>
      ) : mode === 'queue' ? (
        /* ------------------------------------------------ this week's queue */
        <div className="mt-3 space-y-3 animate-fade-in">
          {/* Items whose finish week has passed while still short of 100%. They
              are NOT queued: at W43 there are 44 of them, which is a project
              problem for the Review page, not a list to hand whoever is filling
              in the week. See lib/worklist.ts. */}
          {worklist.stuck.length > 0 && (
            <div className="flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3.5 ring-1 ring-warn/25">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warn text-[13px] font-bold text-white">
                !
              </span>
              <div className="min-w-0 flex-1 text-[13px]">
                <p className="font-semibold text-foreground">
                  {worklist.stuck.length} {worklist.stuck.length === 1 ? 'item is' : 'items are'} past
                  their finish date and not complete
                </p>
                {/* Desktop only. On a phone this sentence wrapped to three
                    lines and pushed the first item of the actual queue a
                    further 80px down a screen that already scrolls to reach
                    it — and the headline above already says what it is. */}
                <p className="mt-0.5 hidden text-muted-foreground sm:block">
                  They are not in this week&apos;s list — they need a decision, not a number.
                </p>
              </div>
              <PressLink {...pressMotion}
                href={`/weekly/${week}/control`}
                className="shrink-0 self-center rounded-lg bg-card px-3 py-2 text-[13px] font-semibold text-warn shadow-sm transition-colors hover:brightness-105"
              >
                Review
              </PressLink>
            </div>
          )}

          {/* The counter. It is the only thing on the page that says when the
              week is finished, so it counts DEALT WITH rather than changed —
              "no progress" is an answer. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border bg-card px-4 py-3.5 shadow-sm ring-1 ring-foreground/10 sm:px-5">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">
                {queueDue.length === 0
                  ? queueTotal === 0
                    ? 'Nothing is scheduled for this week'
                    : "This week's list is done"
                  : `${queueDue.length} ${queueDue.length === 1 ? 'item' : 'items'} to fill in`}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {queueTotal === 0
                  ? 'No contract has work planned in these dates.'
                  : `${queueDone.length} of ${queueTotal} done · scheduled for Week ${week}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {queueTotal > 0 && (
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted sm:w-32">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      queueDue.length === 0 ? 'bg-ok' : 'bg-chart-1'
                    )}
                    style={{ width: `${queueTotal ? (queueDone.length / queueTotal) * 100 : 0}%` }}
                  />
                </div>
              )}
              <button
                onClick={() => setMode('browse')}
                className="shrink-0 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-chart-1 transition-colors hover:bg-chart-1/10"
              >
                Browse all {flatAll.filter((n) => n.children.length === 0 && !isMilestone(n)).length}
              </button>
            </div>
          </div>

          {queueDue.map((entry) => (
            <QueueCard
              key={entry.node.id}
              entry={entry}
              pathBase={pathBase}
              onNoProgress={() => markNone(entry.node)}
              leafProps={leafProps}
            />
          ))}

          {queueDue.length === 0 && queueTotal > 0 && (
            <div className="rounded-2xl border border-dashed bg-card px-5 py-10 text-center">
              <p className="text-[15px] font-semibold text-ok">Every item due this week is done</p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                Next: check the figures on Review, then print the report.
              </p>
              <PressLink {...pressMotion}
                href={`/weekly/${week}/control`}
                className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-chart-1 px-5 text-[14px] font-semibold text-white shadow-sm transition-colors hover:brightness-110"
              >
                Go to Review
              </PressLink>
            </div>
          )}

          {queueDone.length > 0 && (
            <div className="rounded-2xl border bg-card shadow-sm ring-1 ring-foreground/10">
              <button
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left sm:px-5"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok text-white">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span className="flex-1 text-[14px] font-semibold">
                  {queueDone.length} already dealt with
                </span>
                <svg
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300"
                  style={{ transform: showDone ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showDone && (
                <div className="space-y-3 border-t px-3 py-3 sm:px-4">
                  {queueDone.map((entry) => (
                    <QueueCard
                      key={entry.node.id}
                      entry={entry}
                      pathBase={pathBase}
                      leafProps={leafProps}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {worklist.hasSchedule && (
            <button
              onClick={() => setMode('queue')}
              className="mt-3 flex items-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-semibold text-chart-1 transition-colors hover:bg-chart-1/10"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to this week&apos;s list
            </button>
          )}
          {/* Breadcrumb + level header */}
          {currentPath.length > 0 && (
            <div className="mt-3 rounded-2xl border bg-card ring-1 ring-foreground/10 px-5 py-4 shadow-sm animate-fade-in">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <m.button {...pressMotion}
                  onClick={goBack}
                  className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-muted-foreground transition-colors hover:text-chart-1"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </m.button>
                <span className="mx-1 text-muted-foreground/60">|</span>
                <button onClick={() => goToLevel(-1)} className="text-muted-foreground transition-colors hover:text-chart-1">
                  All contracts
                </button>
                {currentPath.map((p, i) => (
                  <span key={p.id} className="flex items-center gap-2">
                    <span className="text-muted-foreground/60">›</span>
                    {i === currentPath.length - 1 ? (
                      <span className="font-semibold text-foreground">{shortName(p.deskripsi)}</span>
                    ) : (
                      <button onClick={() => goToLevel(i)} className="text-muted-foreground transition-colors hover:text-chart-1">
                        {shortName(p.deskripsi)}
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {currentNode && (
                <div className="mt-3 flex items-center gap-4">
                  <Ring
                    pct={currentCumOf(currentNode, edits)}
                    color={statusOf(currentCumOf(currentNode, edits), round2(planPctOf(currentNode))).ring}
                    textColor={statusOf(currentCumOf(currentNode, edits), round2(planPctOf(currentNode))).ringText}
                    size={48}
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-foreground">
                      <TruncatedName
                        text={currentNode.deskripsi}
                        accent={statusOf(currentCumOf(currentNode, edits), round2(planPctOf(currentNode))).ring}
                      />
                    </h2>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {leafCount(currentNode)} activities · Weight {currentNode.bobot.toFixed(2)}% ·{' '}
                      Plan {round2(planPctOf(currentNode)).toFixed(1)}%
                      <GapInline cum={round2(currentNode.curProgressPct)} plan={round2(planPctOf(currentNode))} />
                    </p>
                    <GapBottomRow cum={round2(currentNode.curProgressPct)} plan={round2(planPctOf(currentNode))} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Level cards — keyed so each navigation replays the slide, and now
              so the level being LEFT slides out rather than simply ceasing to
              exist. See components/motion/Swap.tsx for why this is allowed to
              be framer-motion when the page's entrances are not. */}
          <Swap key={levelKey} levelKey={levelKey} direction={direction} className="mt-3">
            <div className="space-y-2.5">
              {currentNodes.map((node, idx) =>
                node.children.length > 0 ? (
                  <FolderCard
                    key={node.id}
                    node={node}
                    index={idx}
                    onOpen={() => navigateInto(node)}
                    cum={round2(node.curProgressPct)}
                    plan={round2(planPctOf(node))}
                  />
                ) : (
                  <div key={node.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}>
                    <LeafCard node={node} {...leafProps} />
                  </div>
                )
              )}
              {currentNodes.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border bg-muted/40 py-10 text-center text-sm text-muted-foreground">
                  No activities at this level.
                </div>
              )}
            </div>
          </Swap>
        </>
      )}

      {/* Floating save bar — morphs through unsaved → saving → saved.
          Under autosave it is a status line rather than a control: it appears
          for the second between an edit settling and the write landing, and
          stays put only when a write FAILED, which is the one case where the
          person has to know their number is not stored yet. */}
      {(dirtyCount > 0 || justSaved) && (
        <div
          className={`sticky bottom-3 z-30 px-1 sm:bottom-4 sm:px-0 ${
            barLeaving ? 'animate-save-out' : 'animate-save-bar-in'
          }`}
        >
          <div
            className={`mx-auto flex max-w-xl items-center justify-between gap-2 rounded-2xl border px-2.5 py-3 shadow-xl backdrop-blur transition-colors duration-300 min-[360px]:px-3 sm:gap-4 sm:px-5 sm:py-3.5 ${
              justSaved ? 'ring-ok/40 bg-ok-soft/95' : 'bg-card ring-1 ring-foreground/10/95'
            }`}
          >
            {justSaved ? (
              <div className="flex items-center gap-3 text-[15px] font-semibold text-ok">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ok text-white animate-pop-in">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path className="animate-check-draw" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span className="animate-label-in">Changes saved</span>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-semibold text-foreground min-[360px]:text-[14px] min-[380px]:gap-2.5 min-[380px]:text-[15px] sm:gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warn text-white animate-badge-pending min-[360px]:h-7 min-[360px]:w-7">
                    <svg className="h-3 w-3 min-[360px]:h-3.5 min-[360px]:w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49l2.65 2.65a1.5 1.5 0 010 2.12l-9.2 9.2-4.24.71.71-4.24 9.2-9.2a1.5 1.5 0 012.12 0z" />
                    </svg>
                  </span>
                  <span className="animate-label-in whitespace-nowrap">
                    {saveFailed
                      ? "Couldn't save"
                      : saving
                        ? 'Saving…'
                        : dirtyCount === 1
                          ? 'Unsaved change'
                          : 'Unsaved changes'}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  {/* Cancel keeps its box while saving and only fades — collapsing
                      or dimming it mid-save shoved the row sideways on phones. */}
                  <button
                    onClick={discardAll}
                    disabled={saving}
                    aria-hidden={saving}
                    className={`rounded-lg px-2 py-2 text-[13px] font-medium text-muted-foreground transition-opacity duration-200 hover:bg-muted hover:text-foreground disabled:pointer-events-none min-[380px]:px-2.5 min-[380px]:text-[14px] sm:px-3.5 ${
                      saving ? 'opacity-0' : 'opacity-100'
                    }`}
                  >
                    Cancel
                  </button>
                  {/* Both labels sit in one grid cell so the button is always as
                      wide as "Saving…" — swapping text in place used to resize it
                      mid-save and push Cancel across the bar. */}
                  <m.button {...pressMotion}
                    // Not `onClick={save}`: that hands the MouseEvent to
                    // `silent`, and a manual save would swallow its own errors.
                    onClick={() => {
                      setSaveFailed(null);
                      save();
                    }}
                    disabled={saving}
                    aria-label={saving ? 'Saving' : saveFailed ? 'Retry saving' : 'Save'}
                    className="grid place-items-center rounded-lg bg-chart-1 px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:brightness-110 hover:shadow-md disabled:pointer-events-none min-[380px]:px-3.5 min-[380px]:text-[14px] sm:px-5"
                  >
                    <span
                      className={`col-start-1 row-start-1 transition-opacity duration-150 ${
                        saving ? 'opacity-0' : 'opacity-100'
                      }`}
                    >
                      {saveFailed ? 'Retry' : 'Save'}
                    </span>
                    <span
                      className={`col-start-1 row-start-1 flex items-center gap-2 transition-opacity duration-150 ${
                        saving ? 'opacity-100' : 'opacity-0'
                      }`}
                    >
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {/* Phones get the spinner alone: the word would make the
                          button permanently as wide as "Saving…" and squeeze the
                          one-line row that narrow screens barely fit. */}
                      <span className="hidden sm:inline">Saving…</span>
                    </span>
                  </m.button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function currentCumOf(node: RollupNode, edits: Record<string, EditState>): number {
  return round2(edits[node.id]?.cumProgressPct ?? node.curProgressPct);
}

/** Trim long WBS descriptions for breadcrumbs. */
function shortName(s: string): string {
  return s.length > 28 ? s.slice(0, 26).trimEnd() + '…' : s;
}

function isTodayAt(iso: string, todayStart: number): boolean {
  return new Date(iso).getTime() >= todayStart;
}

// ============================================================================

function Ring({ pct, color, textColor, size = 56 }: { pct: number; color: string; textColor: string; size?: number }) {
  const stroke = size >= 56 ? 6 : 5;
  const r = size / 2 - stroke - 1;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp(pct) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F3F4F6" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.4s' }}
      />
      <text
        x={size / 2}
        y={size / 2 + 4.5}
        textAnchor="middle"
        fontSize={size >= 56 ? 13 : 12}
        fontWeight={600}
        fill={textColor}
      >
        {Math.round(pct)}
      </text>
    </svg>
  );
}

const FolderCard = memo(function FolderCard({
  node, index, onOpen, cum, plan,
}: {
  node: RollupNode;
  index: number;
  onOpen: () => void;
  cum: number;
  plan: number;
}) {
  const st = statusOf(cum, plan);
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-2xl border bg-card ring-1 ring-foreground/10 px-5 py-4 text-left shadow-sm transition-all duration-300 ease-ios hover:-translate-y-0.5 hover:border-border hover:shadow-md active:scale-[0.99] animate-fade-in-up"
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
    >
      <Ring pct={cum} color={st.ring} textColor={st.ringText} />
      <div className="min-w-0 flex-1">
        <TruncatedName text={node.deskripsi} className="text-[15px] font-semibold text-foreground" accent={st.ring} />
        <div className="mt-1 text-[13px] text-muted-foreground">
          {leafCount(node)} activities · Plan {plan.toFixed(1)}%
          <GapInline cum={cum} plan={plan} />
        </div>
        <GapBottomRow cum={cum} plan={plan} />
      </div>
      <span className={`hidden shrink-0 rounded-full px-3 py-1 text-[12px] font-medium sm:inline ${st.chip}`}>
        {st.label}
      </span>
      <svg
        className="h-5 w-5 shrink-0 text-muted-foreground/60 transition-all group-hover:translate-x-0.5 group-hover:text-chart-1"
        fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
});

// ============================================================================

/**
 * One queued item: where it lives, how far into its span it is, and the way out
 * for the week where the honest answer is "nothing happened".
 *
 * The strip above the card carries the contract, because in the queue an
 * activity has been lifted out of the tree that gave it its context —
 * "Piping Installation" appears under three different SPKs, and the drill-down
 * answered that with the breadcrumb the queue does not have.
 *
 * "No progress" writes a change-log entry that moves nothing (see
 * `markNoProgress` in lib/mutations.ts). Without it the counter above the queue
 * could never reach zero on a week where an item genuinely did not move, and a
 * progress counter that cannot finish is worse than none.
 */
function QueueCard({
  entry,
  pathBase,
  onNoProgress,
  leafProps,
}: {
  entry: WorklistEntry;
  pathBase: number;
  onNoProgress?: () => void;
  leafProps: Omit<LeafCardProps, 'node'>;
}) {
  const trail = entry.trail.slice(pathBase);
  return (
    <div className="animate-fade-in-up">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <span className="min-w-0 truncate text-[12px] text-muted-foreground">
          {trail.map(shortName).join(' › ') || 'Top level'}
          {entry.spanWeeks > 1 && (
            <span className="ml-1.5 whitespace-nowrap text-muted-foreground/70">
              · week {entry.weekOfSpan} of {entry.spanWeeks}
            </span>
          )}
        </span>
        {onNoProgress ? (
          <button
            onClick={onNoProgress}
            className="shrink-0 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            No progress
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Done
          </span>
        )}
      </div>
      <LeafCard node={entry.node} {...leafProps} />
    </div>
  );
}

interface LeafCardProps {
  node: RollupNode;
  week: number;
  recentIds: Set<string>;
  recentChanges: ChangeLogEntry[];
  edits: Record<string, EditState>;
  rawInputs: Record<string, { cum?: string; plan?: string }>;
  detailOpen: Set<string>;
  snapshots: Record<string, LeafSnapshot | undefined>;
  askQty: { node: RollupNode; total: string; unit: string } | null;
  setAskQty: (v: { node: RollupNode; total: string; unit: string } | null) => void;
  confirmQty: () => void;
  currentCum: (n: RollupNode) => number;
  currentPlan: (n: RollupNode) => number;
  setEdit: (id: string, patch: EditState) => void;
  setRawInputs: React.Dispatch<React.SetStateAction<Record<string, { cum?: string; plan?: string }>>>;
  adjustCum: (n: RollupNode, delta: number) => void;
  toggleDetail: (id: string) => void;
  onSwitchMethod: (node: RollupNode, method: ProgressMethod) => void;
  switching: boolean;
}

/**
 * One item, and the one control that fills it in.
 *
 * THE CARD ASKS THE QUESTION THE ITEM CAN ANSWER. An item measured by quantity
 * is asked how many metres are done; one measured by milestones is asked which
 * ones are ticked; only an item with neither is asked for a percentage. This
 * used to be split across two tabs — "Data Overall" typed percentages and a
 * separate "Field Input" table collected evidence — which meant every person
 * filling in a week first had to choose a screen, and the answer depended on a
 * property of the item they could not see from either.
 *
 * The percentage stays visible in all three cases, because it is what the
 * report is made of; for quantity and milestone items it is READ-ONLY, derived
 * from the evidence beside it, which is the whole point of measuring.
 */
const LeafCard = memo(function LeafCard({
  node, week, recentIds, recentChanges, edits, rawInputs, detailOpen, snapshots,
  currentCum, currentPlan, setEdit, setRawInputs, adjustCum, toggleDetail,
  onSwitchMethod, switching, askQty, setAskQty, confirmQty,
}: LeafCardProps) {
  const asking = askQty?.node.id === node.id ? askQty : null;
  const method = methodOf(node);
  const edit = edits[node.id];
  const snap = snapshots[node.id];
  // Derived for measured items, typed for the rest.
  const derived = pctOf(node, edit, snap);
  const cum = derived ?? currentCum(node);
  const plan = currentPlan(node);
  // The stepper sizes its input from this string, so it has to be the exact
  // text the input renders — typing buffer first, formatted value otherwise.
  const cumShown = rawInputs[node.id]?.cum ?? cum.toFixed(cum % 1 === 0 ? 0 : 1);
  const isDirty = !!edit;
  const isRecent = recentIds.has(node.id);
  const isDone = cum >= 99.95 && !isDirty;
  const showDetail = detailOpen.has(node.id);
  const st = statusOf(cum, plan);
  const gap = gapText(cum, plan);
  const thisWeek = round2(cum - node.prevProgressPct);

  const history = useMemo(
    () =>
      recentChanges
        .filter((c) => c.leafId === node.id)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 4),
    [recentChanges, node.id]
  );

  return (
    <div
      className={cn(
        'rounded-2xl bg-card px-4 py-4 shadow-sm ring-1 transition-all duration-300 ease-ios sm:px-5',
        isDirty ? 'ring-2 ring-warn/40' : 'ring-foreground/10',
        isDone && 'opacity-75 hover:opacity-100'
      )}
    >
      {/* ---------------------------------------------------------- name row */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold leading-snug">{node.deskripsi}</span>
            {isRecent && !isDirty && (
              <Badge variant="secondary" className="bg-chart-1/10 text-chart-1">
                New
              </Badge>
            )}
            {isDirty && (
              <Badge variant="secondary" className="bg-warn-soft text-warn">
                Unsaved
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
            {node.wbsCode} · Weight {node.bobot.toFixed(3)}%
          </p>
        </div>
        {/* The figure is the headline of the card, and for a measured item it is
            the only place the percentage appears at all. */}
        <div className="shrink-0 text-right">
          <div className={cn('text-2xl font-semibold tabular-nums leading-none', isDone && 'text-ok')}>
            {cum.toFixed(cum % 1 === 0 ? 0 : 1)}%
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Plan {plan.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------- bar */}
      <div className="relative mt-3 h-2.5 rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', st.bar)}
          style={{ width: `${clamp(cum)}%` }}
        />
        {plan > 0.5 && plan < 99.5 && (
          <div
            className="absolute -top-[3px] h-4 w-[3px] rounded-full bg-chart-2"
            style={{ left: `calc(${clamp(plan)}% - 1px)` }}
            title={`Plan ${plan.toFixed(1)}%`}
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-x-3 text-[12px] text-muted-foreground">
        <span>
          Last week <span className="font-medium text-foreground">{node.prevProgressPct.toFixed(1)}%</span>
          {thisWeek !== 0 && (
            <span className={thisWeek > 0 ? 'text-ok' : 'text-bad'}>
              {' '}({thisWeek > 0 ? '+' : ''}{thisWeek.toFixed(1)}%)
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2.5">
          <span className={cn('hidden font-semibold sm:inline', gap.cls)}>{gap.text}</span>
          <span className="hidden sm:contents">
            <DetailToggle open={showDetail} onClick={() => toggleDetail(node.id)} />
          </span>
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-x-3 sm:hidden">
        <GapBottomRow cum={cum} plan={plan} className="" />
        <DetailToggle open={showDetail} onClick={() => toggleDetail(node.id)} />
      </div>

      {/* ------------------------------------------------------------ entry */}
      {/* Its own well, below the reading, so "where do I fill this in" is never
          a question — and so the control can be full width on a phone. */}
      <div className="mt-3 rounded-xl bg-muted/50 p-3">
        {asking ? (
          // Switching to quantity needs a real total first. Asked HERE, inside
          // the item's own card: as a banner at the top of the page it named an
          // item that was two screens further down.
          <div>
            <p className="text-[12px] font-semibold">How much of it is there in total?</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              This item is recorded as lumpsum, so it has nothing to count yet. The progress
              already reported is carried across into the new unit, not lost.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Input
                autoFocus
                inputMode="decimal"
                value={asking.total}
                onChange={(e) => setAskQty({ ...asking, total: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && confirmQty()}
                placeholder="340"
                className="w-24 bg-background text-right tabular-nums"
              />
              <Input
                value={asking.unit}
                onChange={(e) => setAskQty({ ...asking, unit: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && confirmQty()}
                placeholder="m, m3, kg…"
                className="w-36 bg-background"
              />
              <Button
                size="sm"
                onClick={confirmQty}
                disabled={switching || !asking.total.trim() || !asking.unit.trim()}
              >
                Set total
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAskQty(null)} disabled={switching}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {!asking && method === 'qty' && (
          <QuantityEntry node={node} edit={edit} snap={snap} setEdit={setEdit} />
        )}

        {!asking && method === 'milestone' && (
          <MilestoneEntry node={node} edit={edit} snap={snap} setEdit={setEdit} />
        )}

        {!asking && method === 'lumpsum' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium">Percent complete</p>
              <p className="text-[11px] text-bad">Typed by hand — nothing on site to check it against</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StepBtn onClick={() => adjustCum(node, -5)} label="Decrease 5%">−</StepBtn>
              {/* The BOX is drawn by this label and keeps a fixed width, so the
                  row never jitters as digits come and go; the input inside
                  shrink-wraps its value so the number and its "%" read as one
                  pair centred in the box. It has to be a label, not a span:
                  once the input is only as wide as one digit, the box must take
                  the tap and hand focus over, or most of this 88px control is
                  dead to a thumb. */}
              <label className="flex h-11 w-[88px] cursor-text items-center justify-center gap-1.5 overflow-hidden rounded-xl border bg-background px-1 shadow-sm transition-all focus-within:border-chart-1 focus-within:ring-4 focus-within:ring-chart-1/15 sm:h-10">
                <input
                  type="text"
                  inputMode="decimal"
                  value={cumShown}
                  style={{ width: `${chWidth(cumShown)}ch` }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], cum: raw } }));
                    const parsed = parseInput(raw, round2(node.curProgressPct));
                    if (parsed !== null) setEdit(node.id, { cumProgressPct: parsed });
                  }}
                  onBlur={() => setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], cum: undefined } }))}
                  className="max-w-full shrink border-none bg-transparent p-0 text-center text-[17px] font-semibold tabular-nums outline-none focus:ring-0 sm:text-[15px]"
                />
                <span className="shrink-0 text-[15px] font-medium text-muted-foreground sm:text-[13px]">%</span>
              </label>
              <StepBtn onClick={() => adjustCum(node, 5)} label="Increase 5%">+</StepBtn>
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------------- expandable rest */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: showDetail ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mt-3.5 space-y-4 rounded-xl bg-muted/50 p-4">
            {/* Switching how an item is measured is a deliberate act, so it
                lives one fold down rather than beside the value. Native select:
                a level can hold ninety of these cards, and a Radix Select in
                each is ninety portals (AGENTS.md). */}
            <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-3">
              <Field label="Measured by">
                <select
                  value={method}
                  disabled={switching}
                  onChange={(e) => onSwitchMethod(node, e.target.value as ProgressMethod)}
                  className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-[13px] outline-none transition-colors focus:border-chart-1 disabled:opacity-50"
                >
                  {(Object.keys(METHOD_LABEL) as ProgressMethod[]).map((k) => (
                    <option key={k} value={k}>
                      {METHOD_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Edit target (plan)">
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rawInputs[node.id]?.plan ?? plan.toFixed(plan % 1 === 0 ? 0 : 1)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], plan: raw } }));
                      const parsed = parseInput(raw, round2(planPctOf(node)));
                      if (parsed !== null) setEdit(node.id, { planPct: parsed });
                    }}
                    onBlur={() => setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], plan: undefined } }))}
                    className="h-9 w-[70px] rounded-lg border bg-background text-center text-[13px] font-semibold tabular-nums outline-none focus:border-chart-1"
                  />
                  <span className="text-[12px] text-muted-foreground">%</span>
                </div>
              </Field>
              <Field
                label="Contribution to total"
                value={`${round2((node.bobot * cum) / 100).toFixed(3)}%`}
                sub={`${cum.toFixed(1)}% × ${node.bobot.toFixed(2)}%`}
              />
              <Field label="Volume" value={node.vol && node.satuan ? `${node.vol} ${node.satuan}` : '—'} />
              <Field label={`Last week (W${week - 1})`} value={`${node.prevProgressPct.toFixed(2)}%`} />
              <Field label="WBS Code" value={node.wbsCode} />
            </div>
            {history.length > 0 && (
              <div className="border-t pt-3">
                <div className="mb-2 text-[11px] font-semibold text-muted-foreground">History</div>
                <div className="space-y-1.5">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center gap-2 text-[12px]">
                      <span className={cn('h-1.5 w-1.5 rounded-full', h.field === 'cumProgressPct' ? 'bg-chart-1' : 'bg-chart-2')} />
                      <span className="font-medium tabular-nums">
                        {h.field === 'cumProgressPct' ? 'Actual' : 'Plan'} {h.oldValue.toFixed(1)}% → {h.newValue.toFixed(1)}%
                      </span>
                      <span suppressHydrationWarning className="text-muted-foreground">· {timeAgo(h.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * "How much of it is done?" asked in the item's own unit.
 *
 * The buttons move a twentieth of the total rather than one unit: on a 500 m
 * run, a +1 button is a control nobody can reach the end of.
 */
function QuantityEntry({
  node,
  edit,
  snap,
  setEdit,
}: {
  node: RollupNode;
  edit: EditState | undefined;
  snap: LeafSnapshot | undefined;
  setEdit: (id: string, patch: EditState) => void;
}) {
  const total = totalQty(node);
  const done = edit?.qtyDone ?? snap?.qtyDone ?? 0;
  const step = Math.max(1, round2(total / 20));
  const set = (v: number) => setEdit(node.id, { qtyDone: Math.max(0, Math.min(total, round2(v))) });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-medium">How much is finished?</p>
        <p className="text-[11px] text-muted-foreground">
          Out of {total.toLocaleString('en-GB')} {node.satuan ?? ''} in total
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StepBtn onClick={() => set(done - step)} label={`Subtract ${step}`}>−</StepBtn>
        <label className="flex h-11 min-w-[112px] cursor-text items-center justify-center gap-1.5 rounded-xl border bg-background px-2 shadow-sm transition-all focus-within:border-chart-1 focus-within:ring-4 focus-within:ring-chart-1/15 sm:h-10">
          <input
            type="text"
            inputMode="decimal"
            value={String(done)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(',', '.'));
              if (Number.isFinite(n)) set(n);
            }}
            className="w-14 border-none bg-transparent p-0 text-center text-[17px] font-semibold tabular-nums outline-none focus:ring-0 sm:text-[15px]"
          />
          <span className="shrink-0 text-[13px] font-medium text-muted-foreground">
            {node.satuan ?? ''}
          </span>
        </label>
        <StepBtn onClick={() => set(done + step)} label={`Add ${step}`}>+</StepBtn>
      </div>
    </div>
  );
}

/** "Which ones are through?" — the ladder, as buttons big enough for a thumb. */
function MilestoneEntry({
  node,
  edit,
  snap,
  setEdit,
}: {
  node: RollupNode;
  edit: EditState | undefined;
  snap: LeafSnapshot | undefined;
  setEdit: (id: string, patch: EditState) => void;
}) {
  const ms = node.milestones ?? [];
  const done = edit?.milestonesDone ?? snap?.milestonesDone ?? [];

  return (
    <div>
      <p className="text-[12px] font-medium">Which milestones are through?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ms.map((m) => {
          const on = done.includes(m.id);
          return (
            <button
              key={m.id}
              onClick={() =>
                setEdit(node.id, {
                  milestonesDone: on ? done.filter((x) => x !== m.id) : [...done, m.id],
                })
              }
              title={`${m.label} · ${m.weight}%`}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition-all duration-300 ease-ios active:scale-[0.97]',
                on ? 'border-ok/40 bg-ok-soft text-ok' : 'bg-background hover:bg-muted'
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full border text-[10px]',
                  on ? 'border-ok bg-ok text-white' : 'border-muted-foreground/40'
                )}
              >
                {on ? '✓' : ''}
              </span>
              {m.label.split('—')[0].trim()}
            </button>
          );
        })}
        {ms.length === 0 && (
          <p className="text-[12px] text-muted-foreground">
            This item has no milestones yet — set them from Details.
          </p>
        )}
      </div>
    </div>
  );
}

function StepBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <m.button {...pressMotion}
      onClick={onClick}
      aria-label={label}
      title={label}
      // Same border and shadow as the value box next to it — a borderless button
      // carried by shadow alone simply did not read as a button. It also sits a
      // touch shorter than that box, which is what keeps the box the anchor of
      // the group rather than three equal slabs.
      className="flex h-10 w-10 items-center justify-center rounded-xl border bg-card ring-1 ring-foreground/10 text-lg font-semibold text-foreground shadow-sm transition-colors hover:bg-muted hover:text-chart-1"
    >
      {children}
    </m.button>
  );
}

function DetailToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-muted-foreground transition-colors duration-300 ease-ios hover:bg-muted hover:text-foreground"
    >
      Details
      <svg
        className="h-3.5 w-3.5 transition-transform duration-300"
        style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function Field({ label, value, sub, children }: { label: string; value?: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {children ?? (
        <>
          <div className="mt-0.5 text-[13px] font-semibold text-foreground">{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
        </>
      )}
    </div>
  );
}
