/** The portal's frame: the brand, and the page. No staff navigation. */
export function PortalShell({ children, name, signOut }: { children: React.ReactNode; name?: string; signOut?: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto min-h-screen max-w-3xl px-5 py-8">
      <header className="mb-8 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-brand/50 bg-gradient-to-br from-brand/40 to-surface font-display text-[9px] font-bold leading-[1.05] tracking-[0.12em] shadow-glow">
          <span>
            ORLA
            <br />
            DENT
            <br />
            <span className="text-accent">CAMP</span>
          </span>
        </span>
        <span className="flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.28em] text-muted">OrlaDent Camp · student portal</span>
          {name && (
            <span className="block text-sm" dir="auto">
              {name}
            </span>
          )}
        </span>
        {signOut}
      </header>
      {children}
    </main>
  );
}
