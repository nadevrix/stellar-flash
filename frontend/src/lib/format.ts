export const short = (s: string, n = 6) => (s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-4)}`);

export const fmtStroops = (stroops: bigint | string | number | null | undefined) => {
  if (stroops === null || stroops === undefined) return '—';
  const n = typeof stroops === 'bigint' ? stroops : BigInt(stroops);
  return (Number(n) / 1e7).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 });
};

export const ms = (us: number) => `${(us / 1000).toFixed(us < 10_000 ? 2 : 0)} ms`;

export const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

export const toStroops = (s: string): bigint => {
  const t = s.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('Invalid amount');
  const [w, f = ''] = t.split('.');
  if (f.length > 7) throw new Error('Use at most 7 decimal places');
  const n = BigInt(w) * 10_000_000n + BigInt((f + '0000000').slice(0, 7));
  if (n <= 0n) throw new Error('Invalid amount');
  return n;
};

export const toHorizonAmount = (s: string): string => {
  const stroops = toStroops(s);
  const whole = stroops / 10_000_000n;
  const frac = stroops % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, '0').replace(/0+$/, '')}`;
};

export const EXPERT = {
  tx: (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`,
  contract: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
  account: (g: string) => `https://stellar.expert/explorer/testnet/account/${g}`,
};
