import { warmPdfRenderer } from '@/lib/pdf';

// SavePdfButton pings this the moment it appears on screen, so the seconds of
// Chromium boot happen while the user is still reading — not after they tap.
// Same maxDuration as the real PDF routes: identical config keeps this handler
// bundled into the same Vercel function, so the browser this boots is the very
// instance the download reuses. (Covered by the '/api/pdf/**' tracing include
// in next.config.ts, which ships the Chromium binary into the lambda.)
export const maxDuration = 60;

export async function GET() {
  try {
    await warmPdfRenderer();
  } catch (error) {
    // A failed warmup must never surface anywhere a user can see it — the real
    // PDF route retries the launch and reports its own error.
    console.error('PDF warmup failed:', error);
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
