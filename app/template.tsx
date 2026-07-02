import { ViewTransition } from "react";

// Remounts on every navigation, so each route change gets a smooth
// exit/enter view transition (see the vt-* rules in globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
