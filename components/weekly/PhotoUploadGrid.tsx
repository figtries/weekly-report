'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PhotoUploadGrid({
  photos,
  uploadUrl,
}: {
  photos: (string | null)[];
  uploadUrl: string;
}) {
  const router = useRouter();
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  async function handleFile(slot: number, file: File) {
    setBusySlot(slot);
    try {
      const formData = new FormData();
      formData.append('slot', String(slot));
      formData.append('file', file);
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

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {photos.map((photo, slot) => (
        <div
          key={slot}
          className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm transition-all duration-500 ease-ios hover:shadow-lg hover:-translate-y-0.5 animate-fade-in-up"
          style={{ animationDelay: `${slot * 60}ms` }}
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
      ))}
    </div>
  );
}
