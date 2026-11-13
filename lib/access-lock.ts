import { AREAS, type AreaKey } from '@/lib/roles';

/** Which Roles row a path belongs to; null for pages no row covers (login, print).
 *  Self-contained on purpose: LOCK_SCRIPT ships its source as text. */
export function areaOf(pathname: string): AreaKey | null {
  if (pathname === '/') return 'dashboard';
  if (/^\/weekly\/[^/]+\/(overall|control|weights)(\/|$)/.test(pathname)) return 'overall';
  if (pathname.startsWith('/weekly')) return 'weekly';
  if (pathname.startsWith('/daily')) return 'daily';
  if (pathname.startsWith('/dokumen')) return 'dokumen';
  if (pathname.startsWith('/projects') || pathname.startsWith('/portfolio')) return 'projects';
  if (pathname.startsWith('/roles') || pathname.startsWith('/settings')) return 'roles';
  return null;
}

/*
 * No flash of a page the account cannot open (29 Oct 2026). `AccessGate` can
 * only cover a page once React has hydrated, and until then the server's page
 * was on screen. This runs inline before the first paint (app/layout.tsx), reads
 * the same localStorage `lib/signed-in.ts` writes, and sets `data-locked` on
 * <html>, which hides <main> (globals.css) until AccessGate's cover takes over.
 * The same pass writes every area the account cannot open into `data-deny`,
 * which hides those sidebar rows from the first paint too, until the sidebar's
 * own filtered list is up (`Links` in Sidebar.tsx).
 * Mirrors `canOpen`, on the cache `syncAuth` keeps; an empty cache opens nothing.
 */
const AREA_KEYS = JSON.stringify(AREAS.map((a) => a.key));

/** Sign in and checkout paint without the app's chrome; see `useBareScreen`. */
export const BARE_SCRIPT = `if(/^\\/(login|payment)(\\/|$)/.test(location.pathname))document.documentElement.setAttribute('data-bare','')`;

export const LOCK_SCRIPT = `(function(){try{var who=localStorage.getItem('lucille-signed-in');if(!who)return;var list=JSON.parse(localStorage.getItem('lucille-accounts')||'null')||[];var a=null;for(var i=0;i<list.length;i++)if(list[i].email.toLowerCase()===who)a=list[i];if(a&&a.master)return;var keys=${AREA_KEYS},deny=[];for(var k=0;k<keys.length;k++)if(!a||a.status==='suspended'||a.access[keys[k]]==='none')deny.push(keys[k]);var r=document.documentElement;if(deny.length)r.setAttribute('data-deny',deny.join(' '));var area=(${areaOf.toString()})(location.pathname);if(area&&deny.indexOf(area)>=0)r.setAttribute('data-locked','')}catch(e){}})()`;
