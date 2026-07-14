'use client';

// A print request must never be dropped. The Print button lives in the week
// toolbar (rendered by the layout, hydrated early) while the sheet that answers
// it lives in the page and arrives later still — it is a dynamic() chunk. A
// plain window event fired in that gap lands on nobody and the tap does
// nothing: the user presses Print, the app shrugs, and they press it again.
//
// So a request with no listener is LATCHED and replayed to the first listener
// that shows up. It expires, because a stale request must not fire a print
// dialog at somebody who has since navigated somewhere else.
const REQUEST_TTL_MS = 15_000;

let pendingAt = 0;
const listeners = new Set<() => void>();

export function requestPrint(): void {
  if (listeners.size > 0) {
    for (const fire of listeners) fire();
    return;
  }
  pendingAt = Date.now();
}

export function subscribeToPrintRequests(fire: () => void): () => void {
  listeners.add(fire);
  const replay = pendingAt > 0 && Date.now() - pendingAt < REQUEST_TTL_MS;
  pendingAt = 0;
  // A timeout, not requestAnimationFrame: rAF never fires while the tab is
  // hidden, and it would also mean setting state inside the subscriber's mount
  // effect. This lets the current commit finish first.
  if (replay) setTimeout(fire, 0);
  return () => {
    listeners.delete(fire);
  };
}
