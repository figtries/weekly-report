import { eq } from 'drizzle-orm';

import { getActiveProjectId } from '@/lib/projects';
import type { RegisterKind } from '@/lib/schema';
import { db, schema } from '@/lib/sqlite';
import { buildRegisterWorkbook } from '@/lib/xlsx/register-export';

/**
 * The register, out as a workbook, as of the week the screen is on
 * (`?week=`): Summary, the register itself, and Submission Log. The look and the
 * reasons are in `lib/xlsx/register-export.ts`.
 */
// No `export const dynamic` here: under `cacheComponents` that segment config
// is rejected outright by the build. Reading the request's own searchParams is
// what makes this handler per-request, and the register read beneath it is a
// synchronous SQLite query, which needs no Suspense boundary of its own.
export async function GET(request: Request) {
  // The open project comes from a cookie now, so this is a per-request read
  // and cannot be baked into a shell. See lib/projects.ts.
  const projectId = (await getActiveProjectId()) ?? '';
  const url = new URL(request.url);
  const register = (url.searchParams.get('register') === 'vdrl' ? 'vdrl' : 'edl') as RegisterKind;
  const asked = Number(url.searchParams.get('week'));
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0];

  const { buffer, week } = await buildRegisterWorkbook({
    projectId,
    projectName: project?.name ?? '',
    register,
    week: Number.isInteger(asked) && asked > 0 ? asked : undefined,
  });

  const initial = project?.alias?.trim() || 'Register';
  const name = `${initial} ${register.toUpperCase()}${week ? ` W${week}` : ''}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
