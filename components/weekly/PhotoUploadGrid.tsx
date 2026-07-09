'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function PhotoUploadGrid({
  photos,
  uploadUrl,
}: {
  photos: (string | null)[];
  uploadUrl: string;
}) {
  const router = useRouter();
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const pages: (string | null)[][] = [];
  for (let i = 0; i < photos.length; i += PAGE_SIZE) {
    pages.push(photos.slice(i, i + PAGE_SIZE));
  }

  const lastPageEmpty = pages.length > 1 && pages[pages.length - 1].every((p) => p === null);

  async function handleFile(slot: number, file: File) {
    setBusySlot(slot);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('slot', String(slot));
      formData.append('file', compressed);
      const res = await fetch(uploadUrl, { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json();
        alert(body.error ?? 'Upload failed');
        return;
      }
      router.refresh();
    } finally {
      setBusySlot(null);
    }
  }

  async function handleRemove(slot: number) {
    setBusySlot(slot);
    try {
      await fetch(`${uploadUrl}?slot=${slot}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusySlot(null);
    }
  }

  async function handlePageAction(action: 'addPage' | 'removePage') {
    setPageBusy(true);
    try {
      const res = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json();
        alert(body.error ?? 'Action failed');
        return;
      }
      router.refresh();
    } finally {
      setPageBusy(false);
    }
  }

  return (
    <div className="space-y-10">
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
                        className="object-cover transition-transform duration-700 ease-ios group-hover:scale-[1.04]"
                      />
                      <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity duration-300 ease-ios group-hover:opacity-100">
                        <span className="text-xs font-medium text-white">Photo {slot + 1}</span>
                        <button
                          onClick={() => handleRemove(slot)}
                          disabled={busySlot === slot}
                          className="rounded bg-white/90 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-white"
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => inputRefs.current[slot]?.click()}
                      disabled={busySlot === slot}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-400 transition-all duration-300 ease-ios hover:bg-gray-100 hover:text-gray-600 active:scale-[0.98]"
                    >
                      <span className="text-2xl leading-none">+</span>
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
