'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { refreshDbAction } from '@/lib/actions';

const PAGE_SIZE = 6;

// Resize + re-encode in the browser so a 5MB camera photo uploads as a few
// hundred KB — uploads finish fast and fit within online storage limits.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 350 * 1024;

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
}: {
  photos: (string | null)[];
  uploadUrl: string;
}) {
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Local mirror of the photo list so successful uploads/removals show up
  // instantly from the API response instead of waiting for a server re-render.
  const [localPhotos, setLocalPhotos] = useState(photos);
  useEffect(() => {
    setLocalPhotos(photos);
  }, [photos]);

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
    refreshDbAction().catch(() => undefined);
  }

  async function handleFile(slot: number, file: File) {
    setBusySlot(slot);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('slot', String(slot));
      formData.append('file', compressed);
      const res = await fetch(uploadUrl, { method: 'POST', body: formData });
      const body = await readJsonSafe(res);
      if (!res.ok) {
        setError(errorFromResponse(body, res, 'Upload failed'));
        return;
      }
      applyResponse(body);
    } catch {
      setError('Upload failed — check your connection and try again.');
    } finally {
      setBusySlot(null);
    }
  }

  async function handleRemove(slot: number) {
    setBusySlot(slot);
    setError(null);
    try {
      const res = await fetch(`${uploadUrl}?slot=${slot}`, { method: 'DELETE' });
      const body = await readJsonSafe(res);
      if (!res.ok) {
        setError(errorFromResponse(body, res, 'Could not remove photo'));
        return;
      }
      applyResponse(body);
    } catch {
      setError('Could not remove photo — check your connection and try again.');
    } finally {
      setBusySlot(null);
    }
  }

  async function handlePageAction(action: 'addPage' | 'removePage') {
    setPageBusy(true);
    setError(null);
    try {
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
    } catch {
      setError('Action failed — check your connection and try again.');
    } finally {
      setPageBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 animate-fade-in-up">
          <p className="min-w-0">{error}</p>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 text-red-400 transition-colors hover:text-red-600"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {pages.map((pagePhotos, pageIndex) => (
        <section key={pageIndex}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Page {pageIndex + 1}
            </h2>
            {pageIndex === pages.length - 1 && lastPageEmpty && (
              <button
                onClick={() => handlePageAction('removePage')}
                disabled={pageBusy}
                className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                Remove page
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pagePhotos.map((photo, i) => {
              const slot = pageIndex * PAGE_SIZE + i;
              return (
                <div
                  key={slot}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm transition-all duration-500 ease-ios hover:shadow-lg hover:-translate-y-0.5 animate-fade-in-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  {photo ? (
                    <>
                      <Image
                        src={photo}
                        alt={`Documentation ${slot + 1}`}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition-transform duration-700 ease-ios group-hover:scale-[1.04]"
                      />
                      {/* Touch screens have no hover — keep the overlay visible below sm
                          so photos can actually be removed on mobile. */}
                      <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity duration-300 ease-ios group-hover:opacity-100 max-sm:opacity-100">
                        <span className="text-xs font-medium text-white">Photo {slot + 1}</span>
                        <button
                          onClick={() => handleRemove(slot)}
                          disabled={busySlot === slot}
                          className="rounded bg-white/90 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-white disabled:opacity-60"
                        >
                          {busySlot === slot ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => inputRefs.current[slot]?.click()}
                      disabled={busySlot === slot}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-400 transition-all duration-300 ease-ios hover:bg-gray-100 hover:text-gray-600 active:scale-[0.98]"
                    >
                      {busySlot === slot ? (
                        <svg className="h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <span className="text-2xl leading-none">+</span>
                      )}
                      <span className="text-xs font-medium">
                        {busySlot === slot ? 'Uploading…' : `Add photo ${slot + 1}`}
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
              );
            })}
          </div>
        </section>
      ))}
      <button
        onClick={() => handlePageAction('addPage')}
        disabled={pageBusy}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-4 text-sm font-medium text-gray-500 transition-all duration-300 ease-ios hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50"
      >
        <span className="text-lg leading-none">+</span>
        {pageBusy ? 'Working…' : 'Add page (6 more photos)'}
      </button>
    </div>
  );
}
