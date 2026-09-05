import { useState } from 'react';

/**
 * Objeto sobre círculo dorado: el recurso editorial de la web de Stellar.
 * Mientras no existan las fotos, dibuja una versión en línea del mismo objeto,
 * para que la página nunca se vea rota ni con un hueco.
 * Para usar una foto: deja el PNG en `public/objects/<name>.png` (fondo recortado).
 */
type ObjectName = 'stopwatch' | 'telegraph' | 'ticket';

const ART: Record<ObjectName, React.ReactNode> = {
  stopwatch: (
    <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="50" cy="55" r="30" />
      <circle cx="50" cy="55" r="24" strokeWidth="1.4" />
      <path d="M50 25V16M42 16h16M68 30l6-6" />
      <path d="M50 55V37" strokeWidth="4" />
      <path d="M50 55l11 7" strokeWidth="2.6" />
      <circle cx="50" cy="55" r="3" fill="currentColor" stroke="none" />
    </g>
  ),
  telegraph: (
    <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 76h68" strokeWidth="4" />
      <path d="M26 76V66h48v10" />
      <path d="M30 56h34" strokeWidth="4" />
      <circle cx="66" cy="56" r="7" />
      <path d="M30 56v-6M64 40l6-8M72 30l5 4" />
      <circle cx="30" cy="50" r="3.4" fill="currentColor" stroke="none" />
    </g>
  ),
  ticket: (
    <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M28 20h44v58l-8-6-7 6-7-6-7 6-7-6-8 6z" />
      <path d="M38 38h24M38 50h24M38 62h14" strokeWidth="2.6" />
    </g>
  ),
};

export function ObjectShot({
  name, alt, className = '', size = 'h-64 w-64',
}: { name: ObjectName; alt: string; className?: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative grid place-items-center ${size} ${className}`}>
      <div className="absolute inset-0 rounded-full bg-gold" />
      {failed ? (
        <svg viewBox="0 0 100 100" className="relative h-[62%] w-[62%] text-ink" role="img" aria-label={alt}>
          {ART[name]}
        </svg>
      ) : (
        <img
          src={`/objects/${name}.png`} alt={alt} onError={() => setFailed(true)}
          className="relative h-[82%] w-[82%] object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,.18)]"
        />
      )}
    </div>
  );
}
