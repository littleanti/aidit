import type { ReactNode } from 'react';

// Sticky page header bar — pins directly below the global app bar (h-12, see
// AppLayout's `sticky top-0`), mirroring the Thread page's fixed header style so
// every primary screen shares one "fixed top bar" language. Window scroll (and
// any IntersectionObserver infinite scroll on the page) keeps working because
// this only sticks; it does not introduce an inner scroll container.
//
// Placement contract: render it as the FIRST child of a page, and put the
// page's ShellPrompt directly after it. `-mt-4` cancels AppLayout <main>'s pt-4
// so the bar sits flush under the app bar; `-mx-4 … desktop:mx-0` full-bleeds
// over the mobile page padding so the border/background span edge-to-edge.
export default function PageHeaderBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-12 z-10 -mx-4 -mt-4 flex h-12 items-center gap-2 border-b border-term-border bg-term-screen px-4 desktop:mx-0 desktop:px-0">
      {children}
    </div>
  );
}
