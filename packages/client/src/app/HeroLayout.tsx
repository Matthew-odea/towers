import type { ReactNode } from 'react';

/** Landing-style screen with the painted Urithiru beside the content (see CREDITS.md). */
export function HeroLayout({ children }: { children: ReactNode }) {
  return (
    <main className="landing landing--hero storm-field">
      <div className="landing-panel">{children}</div>
      <div className="landing-art" aria-hidden="true" />
    </main>
  );
}
