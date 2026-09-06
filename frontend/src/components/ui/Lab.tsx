/** Primitivos UI al estilo Stellar Lab: limpio, blanco, acento lila. */

export function PageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: React.ReactNode }) {
  return (
    <header className="mb-8 max-w-3xl">
      {eyebrow && <p className="text-sm font-medium text-lab-purple">{eyebrow}</p>}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink lg:text-4xl">{title}</h1>
      {description && <p className="mt-3 text-base leading-relaxed text-muted">{description}</p>}
    </header>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Alert({ tone, children }: { tone: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-teal/30 bg-teal/5 text-ink',
    info: 'border-lab-purple/25 bg-lab-purple/5 text-ink',
  }[tone];
  return <p className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles}`}>{children}</p>;
}

export function BtnPrimary({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {children}
    </button>
  );
}

export function BtnSecondary({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-medium text-ink transition hover:border-ink/25 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {children}
    </button>
  );
}

export function LabInput({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input {...props}
        className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-mono text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-lab-purple focus:ring-2 focus:ring-lab-purple/15" />
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="font-mono text-2xl font-medium tabular-nums text-ink">{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted/70">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={`rounded-md px-4 py-2 text-sm font-medium capitalize transition ${
            value === o.id ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
