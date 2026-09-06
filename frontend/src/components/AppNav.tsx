import { Logo } from './Logo.tsx';
import { StatusPill, useHealth } from './LiveStatus.tsx';

const LINKS = [
  { href: '/bridge', label: 'Bridge' },
  { href: '/account', label: 'Account' },
  { href: '/explorer', label: 'Explorer' },
  { href: '/developers', label: 'Developers' },
] as const;

export function AppNav({ variant = 'light', badge }: { variant?: 'light' | 'dark'; badge?: string }) {
  const { health } = useHealth(8000);
  const dark = variant === 'dark';

  return (
    <header className={`sticky top-0 z-40 border-b backdrop-blur-md ${dark ? 'border-white/10 bg-ink/85' : 'border-ink/8 bg-white/85'}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <a href="/"><Logo onDark={dark} /></a>
          {badge && <span className={`hidden font-mono text-xs sm:inline ${dark ? 'text-white/35' : 'text-ink/35'}`}>{badge}</span>}
        </div>
        <nav className={`hidden items-center gap-6 text-sm md:flex ${dark ? 'text-white/60' : 'text-ink/60'}`}>
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={dark ? 'transition hover:text-white' : 'transition hover:text-ink'}>{l.label}</a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden sm:block"><StatusPill health={health} /></div>
          <a href="/bridge"
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${dark ? 'bg-gold text-ink hover:bg-gold/90' : 'bg-ink text-white hover:bg-ink/90'}`}>
            Open app
          </a>
        </div>
      </div>
      <nav className={`flex gap-1 overflow-x-auto border-t px-4 py-2 md:hidden ${dark ? 'border-white/10' : 'border-ink/8'}`}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${dark ? 'text-white/70' : 'text-ink/70'}`}>
            {l.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
