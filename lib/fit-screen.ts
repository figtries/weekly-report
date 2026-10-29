/**
 * FULL SCREEN on a desktop (29 Oct 2026): the sidebar goes and the page is
 * zoomed to fill the monitor. `zoom` on <body> rather than a bigger root
 * font-size, because 445 sizes in the app are written in px and would not
 * follow a rem change.
 *
 * BASE is the width a page fills at zoom 1: a `max-w-6xl` page with its
 * `lg:p-8` padding, plus the 48px gutter the logo and exit button sit in.
 * Wider than that, the zoom is screen / BASE; narrower, it stays 1 (never
 * shrinks). The CSS in globals.css applies it only from `lg` and on screen.
 */
const FIT_KEY = 'lucille-fit';
const BASE = 1264;

const ZOOM = `function z(){document.documentElement.style.setProperty('--fit-zoom',String(Math.max(1,innerWidth/${BASE})))}`;

// Runs inline before the first paint (app/layout.tsx), so it is plain ES5.
export const FIT_SCRIPT = `(function(){try{${ZOOM}if(localStorage.getItem('${FIT_KEY}')==='1')document.documentElement.setAttribute('data-fit','');z();addEventListener('resize',z)}catch(e){}})()`;

function setZoom() {
  document.documentElement.style.setProperty('--fit-zoom', String(Math.max(1, innerWidth / BASE)));
}

/**
 * Toggled inside a view transition: the sidebar fades out while the page's
 * snapshot grows into its new, zoomed box (`fit-*` in globals.css). The zoom
 * is set here as well as by the inline script, so a page that never reloaded
 * since the script last ran still gets its figure.
 */
export function setFit(on: boolean) {
  const root = document.documentElement;
  const apply = () => {
    setZoom();
    root.toggleAttribute('data-fit', on);
  };
  try {
    localStorage.setItem(FIT_KEY, on ? '1' : '0');
  } catch {}
  if (!document.startViewTransition) return apply();
  root.setAttribute('data-fitting', '');
  document
    .startViewTransition(apply)
    .finished.finally(() => root.removeAttribute('data-fitting'));
}
