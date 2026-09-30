'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { refreshDbAction } from '@/lib/actions';
import { Reveal } from '@/components/motion/Reveal';
import { Button } from '@/components/ui/button';
import { MOTION, TYPE } from '@/lib/design';

const PAGE_SIZE = 6;

// A local server answers page actions in ~50ms — without a floor the button
// label flicks to "Working…" and back within a few frames, which reads as the
// two labels glitching over each other. Long enough for the label handoff
// (150ms exit + 200ms delayed enter) to play out and register.
const MIN_PAGE_BUSY_MS = 650;

// Resize + re-encode in the browser so a 5MB camera photo uploads as a few
// hundred KB — uploads finish fast and fit within online storage limits.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 350 * 1024;

// An upload route nobody has used for a few minutes is a cold Vercel function.
// On 30 Sep 2026 the two daily uploads waited 4.6 s and 2.7 s before the
// handler read a byte (boot, plus instrumentation.ts pulling the 2 MB database
// snapshot), for a request that answers in 0.1-0.4 s warm. So the route is
// pinged when the grid appears, when the tab comes back and when Add is
// pressed: the boot happens while the file picker is open. Per url, throttled.
const REWARM_MS = 60_000;
const lastWarmAt = new Map<string, number>();

function warmUploadRoute(url: string) {
  const last = lastWarmAt.get(url) ?? -Infinity;
  if (Date.now() - last < REWARM_MS) return;
  lastWarmAt.set(url, Date.now());
  fetch(url, { cache: 'no-store' }).catch(() => undefined);
}

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SKIP_BELOW_BYTES) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // unsupported format — upload the original
  }
}

// The daily API returns the report ({ photos }), the weekly API returns the
// week meta ({ documentation }) — accept either shape.
function photosFromResponse(body: unknown): (string | null)[] | null {
  if (body && typeof body === 'object') {
    const b = body as { photos?: unknown; documentation?: unknown };
    if (Array.isArray(b.photos)) return b.photos as (string | null)[];
    if (Array.isArray(b.documentation)) return b.documentation as (string | null)[];
  }
  return null;
}

async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorFromResponse(body: unknown, res: Response, fallback: string): string {
  const msg = body && typeof body === 'object' && 'error' in body ? (body as { error?: string }).error : null;
  return msg || `${fallback} (${res.status})`;
}

export default function PhotoUploadGrid({
  photos,
  uploadUrl,
  compact = false,
  refreshServer = true,
}: {
  photos: (string | null)[];
  uploadUrl: string;
  /**
   * Re-render the page on the server after each write. The daily screen turns it
   * off: it keeps its own copy (the `photos-updated` event), and a full re-render
   * per photo cost a page render plus ~60 prefetches, and held Back and Save
   * behind the router's action queue until it landed.
   */
  refreshServer?: boolean;
  /**
   * The daily report's light version: three across, no "Page N" headings (until there
   * is more than one page), quiet dashed slots, and "Add 6 more slots" as a text link.
   * The upload, remove and page routes are exactly the same; the weekly pack keeps the
   * default.
   */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const [pageBusy, setPageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function markBusy(slot: number, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(slot);
      else next.delete(slot);
      return next;
    });
  }

  // Every write to this list goes through ONE queue. The route rewrites the
  // whole record, so two uploads landing on two instances at once would each
  // save the list without the other's photo. Queued, the next photo can be
  // picked the moment the last one shows, and none is lost.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }

  useEffect(() => {
    warmUploadRoute(uploadUrl);
    const onVisible = () => {
      if (document.visibilityState === 'visible') warmUploadRoute(uploadUrl);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [uploadUrl]);

  // A photo is on screen before it is stored; closing the tab in between would
  // lose it, so the browser asks first while anything is still uploading.
  useEffect(() => {
    if (busy.size === 0) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy]);

  // Local mirror of the photo list so successful uploads/removals show up
  // instantly from the API response instead of waiting for a server re-render.
  const [localPhotos, setLocalPhotos] = useState(photos);
  useEffect(() => {
    setLocalPhotos(photos);
  }, [photos]);

  // Optimistic previews: object URLs of just-picked files, shown immediately
  // while the upload runs (and kept afterwards — same pixels, no refetch).
  // The ref is the source of truth (only touched from event handlers); the
  // state is a render mirror of it.
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const previewsRef = useRef<Record<number, string>>({});
  useEffect(
    () => () => {
      Object.values(previewsRef.current).forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  function setPreview(slot: number, url: string | null) {
    const old = previewsRef.current[slot];
    if (old && old !== url) URL.revokeObjectURL(old);
    const next = { ...previewsRef.current };
    if (url) next[slot] = url;
    else delete next[slot];
    previewsRef.current = next;
    setPreviews(next);
  }

  const pages: (string | null)[][] = [];
  for (let i = 0; i < localPhotos.length; i += PAGE_SIZE) {
    pages.push(localPhotos.slice(i, i + PAGE_SIZE));
  }

  const lastPageEmpty = pages.length > 1 && pages[pages.length - 1].every((p) => p === null);

  function applyResponse(body: unknown) {
    const next = photosFromResponse(body);
    if (next) {
      setLocalPhotos(next);
      // Tell interested siblings (the daily editor's print snapshot) about the
      // new list right away — the server refresh below can lose a race against
      // a quick Print click.
      window.dispatchEvent(new CustomEvent('photos-updated', { detail: { uploadUrl, photos: next } }));
    }
    // Keep the server tree (and the print sheet) in sync in the background.
    // Done through a Server Action (not router.refresh) so the re-render runs
    // in a request where the expired 'db' tag is guaranteed visible.
    if (refreshServer) refreshDbAction().catch(() => undefined);
  }

  async function handleFile(slot: number, file: File) {
    markBusy(slot, true);
    setError(null);
    let ok = false;
    try {
      const compressed = await compressImage(file);
      // Show the photo right away — the network round trip happens behind it.
      setPreview(slot, URL.createObjectURL(compressed));
      ok = await enqueue(async () => {
        const formData = new FormData();
        formData.append('slot', String(slot));
        formData.append('file', compressed);
        const res = await fetch(uploadUrl, { method: 'POST', body: formData });
        const body = await readJsonSafe(res);
        if (!res.ok) {
          setError(errorFromResponse(body, res, 'Upload failed'));
          return false;
        }
        applyResponse(body);
        return true;
      });
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      if (!ok) setPreview(slot, null);
      markBusy(slot, false);
    }
  }

  async function handleRemove(slot: number) {
    markBusy(slot, true);
    setError(null);
    // Optimistic: clear the slot immediately, put the photo back on failure.
    const previous = localPhotos[slot] ?? null;
    setPreview(slot, null);
    setLocalPhotos((prev) => prev.map((p, i) => (i === slot ? null : p)));
    let ok = false;
    try {
      ok = await enqueue(async () => {
        const res = await fetch(`${uploadUrl}?slot=${slot}`, { method: 'DELETE' });
        const body = await readJsonSafe(res);
        if (!res.ok) {
          setError(errorFromResponse(body, res, 'Could not remove photo'));
          return false;
        }
        applyResponse(body);
        return true;
      });
    } catch {
      setError('Could not remove photo. Check your connection and try again.');
    } finally {
      if (!ok) setLocalPhotos((prev) => prev.map((p, i) => (i === slot ? previous : p)));
      markBusy(slot, false);
    }
  }

  async function handlePageAction(action: 'addPage' | 'removePage') {
    const startedAt = performance.now();
    setPageBusy(true);
    setError(null);
    try {
      await enqueue(async () => {
        const res = await fetch(uploadUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const body = await readJsonSafe(res);
        if (!res.ok) {
          setError(errorFromResponse(body, res, 'Action failed'));
          return;
        }
        applyResponse(body);
      });
    } catch {
      setError('Action failed. Check your connection and try again.');
    } finally {
      const remaining = MIN_PAGE_BUSY_MS - (performance.now() - startedAt);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setPageBusy(false);
    }
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-10'}>
      {error && (
        <Reveal>
          <div className="flex items-start justify-between gap-3 rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad ring-1 ring-bad/25">
            <p className="min-w-0">{error}</p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="shrink-0 text-bad hover:bg-bad/10 hover:text-bad"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>
        </Reveal>
      )}
      {pages.map((pagePhotos, pageIndex) => (
        <section key={pageIndex}>
          <div className={compact && pages.length === 1 ? 'hidden' : 'mb-3 flex items-center justify-between'}>
            <h2 className={compact ? 'text-[13px] font-semibold text-muted-foreground' : TYPE.cardTitle}>Page {pageIndex + 1}</h2>
            {pageIndex === pages.length - 1 && lastPageEmpty && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handlePageAction('removePage')}
                disabled={pageBusy}
              >
                Remove page
              </Button>
            )}
          </div>
          {/* TWO UP ON A PHONE, not one. A single column at 390px makes each
              4/3 slot 268px tall, so a page of six empty "Add photo" boxes was
              about 1730px of scrolling to see what is really one short list.
              Two columns puts the whole page on roughly one screen.

              The 4/3 is NOT what changes to save that height. `object-cover`
              crops to the box, so the box on screen has to be the shape of the
              box that prints — a 16/9 preview would show a crop the report
              never uses, and someone would frame a photo against it. */}
          <div className={compact ? 'grid grid-cols-3 gap-2 sm:gap-3' : 'grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3'}>
            {pagePhotos.map((photo, i) => {
              const slot = pageIndex * PAGE_SIZE + i;
              const preview = previews[slot] ?? null;
              const displayed = preview ?? photo;
              const uploading = busy.has(slot) && preview !== null;
              return (
                <Reveal key={slot} delay={compact ? 0 : MOTION.stagger * i}>
                  <div
                    className={
                      compact
                        ? 'group relative aspect-[4/3] overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10'
                        : 'group relative aspect-[4/3] overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition-all duration-500 ease-ios hover:-translate-y-0.5 hover:shadow-lg'
                    }
                  >
                  {displayed ? (
                    <>
                      {preview ? (
                        // Object URLs can't go through the image optimizer —
                        // render the picked file directly.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preview}
                          alt={`Documentation ${slot + 1}`}
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-ios group-hover:scale-[1.04]"
                        />
                      ) : (
                        <Image
                          src={displayed}
                          alt={`Documentation ${slot + 1}`}
                          fill
                          sizes="(min-width: 1024px) 33vw, 50vw"
                          className="object-cover transition-transform duration-700 ease-ios group-hover:scale-[1.04]"
                        />
                      )}
                      {uploading ? (
                        <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-2">
                          <span className="text-xs font-medium text-white">Uploading…</span>
                          <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </div>
                      ) : (
                        /* Touch screens have no hover — keep the overlay visible below sm
                           so photos can actually be removed on mobile. */
                        <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity duration-300 ease-ios group-hover:opacity-100 max-sm:opacity-100">
                          <span className="hidden text-xs font-medium text-white sm:inline">Photo {slot + 1}</span>
                          <button
                            onClick={() => handleRemove(slot)}
                            disabled={busy.has(slot)}
                            className="rounded bg-white/90 px-2 py-1 text-xs font-medium text-bad transition-colors hover:bg-white disabled:opacity-60"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        warmUploadRoute(uploadUrl);
                        inputRefs.current[slot]?.click();
                      }}
                      disabled={busy.has(slot)}
                      aria-label={`Add photo ${slot + 1}`}
                      className={
                        compact
                          ? 'flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-border bg-card text-muted-foreground transition-colors duration-200 ease-ios hover:border-chart-1/50 hover:bg-chart-1/5 hover:text-chart-1 active:scale-[0.98]'
                          : 'flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground transition-all duration-300 ease-ios hover:bg-accent hover:text-foreground active:scale-[0.98]'
                      }
                    >
                      {busy.has(slot) ? (
                        <svg className="h-6 w-6 animate-spin text-chart-1" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <span className="text-2xl leading-none">+</span>
                      )}
                      <span className="text-xs font-medium">
                        {busy.has(slot) ? 'Working…' : compact ? 'Add' : `Add photo ${slot + 1}`}
                      </span>
                    </button>
                  )}
                  <input
                    ref={(el) => {
                      inputRefs.current[slot] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(slot, file);
                      e.target.value = '';
                    }}
                  />
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>
      ))}
      {compact ? (
        <button
          type="button"
          onClick={() => handlePageAction('addPage')}
          disabled={pageBusy}
          className="min-h-11 text-[13px] font-medium text-chart-1 transition-opacity duration-200 hover:opacity-80 disabled:opacity-50 sm:min-h-0"
        >
          {pageBusy ? 'Working…' : 'Add 6 more slots'}
        </button>
      ) : (
      <Button
        variant="outline"
        onClick={() => handlePageAction('addPage')}
        disabled={pageBusy}
        className="h-auto w-full border-2 border-dashed py-4 text-sm font-medium text-muted-foreground transition-all duration-300 ease-ios hover:text-foreground"
      >
        <span className="text-lg leading-none">+</span>
        {/* Both labels stay mounted, stacked in one grid cell, and hand off
            sequentially (old fades out, new fades in after a delay). Swapping
            a single text node in place repaints mid-frame and can flash both
            labels overlapped for an instant. */}
        <span className="grid text-center">
          <span
            aria-hidden={pageBusy}
            className={`col-start-1 row-start-1 transition-[opacity,transform] duration-200 ease-ios ${
              pageBusy ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0 delay-150'
            }`}
          >
            Add page (6 more photos)
          </span>
          <span
            aria-hidden={!pageBusy}
            className={`col-start-1 row-start-1 transition-[opacity,transform] duration-200 ease-ios ${
              pageBusy ? 'opacity-100 translate-y-0 delay-150' : 'opacity-0 translate-y-1'
            }`}
          >
            Working…
          </span>
        </span>
      </Button>
      )}
    </div>
  );
}
