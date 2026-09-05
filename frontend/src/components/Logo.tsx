/**
 * Marca de Flash: un rayo que atraviesa una órbita.
 *
 * Es original. La política de marca de SDF (stellar.org/brand-policy) prohíbe alterar o
 * recomponer el logo de Stellar — que es un anillo cruzado por dos barras rectas paralelas —
 * así que aquí el elemento que cruza es un rayo en zigzag y la composición es propia.
 * De Stellar solo se comparte la paleta, que sí es de uso libre.
 */
const BOLT = 'M54 0 L18 34 L33 34 L12 64 L48 28 L33 28 Z';

/** Marca completa (anillo + rayo). Para 20px o más. */
export function Mark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="5" />
      <path fill="currentColor" d={BOLT} />
    </svg>
  );
}

/** Solo el rayo: el anillo se ensucia por debajo de 20px (viñetas, píldoras). */
export function Bolt({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path fill="currentColor" d={BOLT} />
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
