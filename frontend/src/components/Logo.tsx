/**
 * Marca de Flash: una "F" cuyo asta está cizallada en diagonal, de modo que la letra
 * y un rayo son la misma forma. Es original — la política de marca de SDF prohíbe
 * alterar el logo de Stellar (stellar.org/brand-policy); solo compartimos su paleta.
 */
export function Mark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M16 4 L58 4 L54 17 L27 17 L25 26 L46 26 L42 38 L22 38 L16 60 L2 60 Z"
      />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark className="h-7 w-7 text-gold" />
      <span className="font-display text-[1.05rem] font-semibold tracking-tight text-white">
        Stellar Flash
      </span>
    </span>
  );
}
