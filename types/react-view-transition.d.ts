// The App Router runs on React canary (vendored inside Next), which ships the
// <ViewTransition> component. @types/react stable doesn't declare it yet.
import "react";

declare module "react" {
  interface ViewTransitionProps {
    children?: React.ReactNode;
    name?: string;
    default?: string | Record<string, string>;
    enter?: string | Record<string, string>;
    exit?: string | Record<string, string>;
    share?: string | Record<string, string>;
    update?: string | Record<string, string>;
  }
  export const ViewTransition: React.ComponentType<ViewTransitionProps>;
}
