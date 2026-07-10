import { redisConfigured } from '@/lib/storage';

// On Vercel the filesystem is ephemeral — without Redis, every save (daily
// reports, week data, photos) silently disappears when a request lands on a
// different lambda. Surface that loudly instead of letting users lose work.
export default function StorageWarning() {
  if (!process.env.VERCEL || redisConfigured) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs sm:text-sm text-amber-800 print:hidden">
      <p className="mx-auto max-w-4xl">
        <span className="font-semibold">Storage is not configured — changes will not be saved.</span>{' '}
        Create an Upstash Redis database (Vercel → Storage → Upstash for Redis), connect it to this
        project so <code className="rounded bg-amber-100 px-1">KV_REST_API_URL</code> and{' '}
        <code className="rounded bg-amber-100 px-1">KV_REST_API_TOKEN</code> are set, then redeploy.
      </p>
    </div>
  );
}
