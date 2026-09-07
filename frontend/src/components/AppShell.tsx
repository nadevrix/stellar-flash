import { NavLink, useLocation } from 'react-router-dom';
import { Mark } from './Logo.tsx';
import { useHealth } from './LiveStatus.tsx';
import { useWallet } from '../context/WalletContext.tsx';

const NAV = [
  { to: '/', label: 'Introduction', end: true, icon: IconHome },
  { to: '/bridge', label: 'Bridge', icon: IconBridge },
  { to: '/account', label: 'Account', icon: IconUser },
  { to: '/explorer', label: 'Transactions', icon: IconList },
  { to: '/developers', label: 'API explorer', icon: IconCode },
] as const;

const FOOTER = [
  { href: 'https://github.com/nadevrix/stellar-flash', label: 'GitHub', icon: IconGithub },
  { href: 'https://github.com/nadevrix/stellar-flash/tree/main/docs', label: 'Documentation', icon: IconDoc },
] as const;

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { health, error } = useHealth(8000);
  const { address, connecting, connect, disconnect } = useWallet();
  const loc = useLocation();
  const onLanding = loc.pathname === '/';

  if (onLanding) return <>{children}</>;

  return (
    <div className="flex min-h-dvh bg-white font-sans text-ink">
      {/* Sidebar — estilo Stellar Lab */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Mark className="h-9 w-9 shrink-0 text-gold" />
          <span className="text-lg font-semibold tracking-tight">Stellar</span>
          <span className="rounded-md bg-lab-purple/10 px-1.5 py-0.5 text-xs font-semibold text-lab-purple">Flash</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.slice(1).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-lab-purple/10 text-lab-purple' : 'text-muted hover:bg-surface hover:text-ink'}`}>
              <Icon className="h-4 w-4 shrink-0 opacity-70" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-border px-3 py-4">
          {FOOTER.map(({ href, label, icon: Icon }) => (
            <a key={href} href={href} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface hover:text-ink">
              <Icon className="h-4 w-4 shrink-0 opacity-60" />
              {label}
            </a>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-white/95 px-4 py-3 backdrop-blur-sm lg:px-6">
          <a href="/" className="flex items-center gap-2.5 lg:hidden">
            <Mark className="h-8 w-8 shrink-0 text-gold" />
            <span className="rounded-md bg-lab-purple/10 px-1.5 py-0.5 text-xs font-semibold text-lab-purple">Flash</span>
          </a>

          {/* Mobile nav */}
          <nav className="flex flex-1 gap-1 overflow-x-auto lg:hidden">
            {NAV.slice(1).map(({ to, label }) => (
              <NavLink key={to} to={to}
                className={({ isActive }) =>
                  `shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${isActive ? 'bg-lab-purple/10 text-lab-purple' : 'text-muted'}`}>
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* Network pill — como Testnet en Lab */}
            <span className="hidden items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-pink-400" />
              Testnet
            </span>

            {/* Health mini */}
            <span className="hidden items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted md:inline-flex" title={error ?? undefined}>
              <span className={`h-1.5 w-1.5 rounded-full ${health?.l1.status === 'HEALTHY' ? 'bg-teal' : health ? 'bg-gold' : 'bg-warm pulse-dot'}`} />
              {health ? health.l1.status.toLowerCase() : 'connecting…'}
            </span>

            {address ? (
              <div className="flex items-center gap-1">
                <NavLink to="/account"
                  className="rounded-lg border border-border px-3 py-1.5 font-mono text-xs hover:bg-surface">
                  {short(address)}
                </NavLink>
                <button onClick={() => void disconnect()} className="rounded-lg px-2 py-1.5 text-xs text-muted hover:text-ink">
                  Disconnect
                </button>
              </div>
            ) : (
              <button onClick={() => void connect()} disabled={connecting}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink/90 disabled:opacity-50">
                {connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-surface px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
    </svg>
  );
}
function IconBridge({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 16h16M7 12h10M10 8h4" strokeLinecap="round" />
    </svg>
  );
}
function IconUser({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" strokeLinecap="round" />
    </svg>
  );
}
function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
    </svg>
  );
}
function IconCode({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconGithub({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02.01 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.21.7.83.58A12.01 12.01 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  );
}
function IconDoc({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 4h8l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M16 4v4h4M10 13h6M10 17h4" strokeLinecap="round" />
    </svg>
  );
}
