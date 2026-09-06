import { useCallback, useEffect, useState } from 'react';
import { Networks, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { FlashApiError, FlashClient, type FlashNetworkInfo, type WithdrawalProofView } from '@flash/sdk';
import { Logo } from '../components/Logo.tsx';
import { AppNav } from '../components/AppNav.tsx';
import { StatusPill, useHealth } from '../components/LiveStatus.tsx';
import { SEQUENCER_URL } from '../lib/api.ts';
import { fmtStroops, toStroops } from '../lib/format.ts';
import { connectWallet, disconnectWallet, restoreWallet, signFlashMessage, signStellarTx } from '../lib/wallet.ts';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON = 'https://horizon-testnet.stellar.org';

const flash = new FlashClient({ baseUrl: SEQUENCER_URL });
const server = new rpc.Server(RPC_URL);

/**
 * Envía a Stellar una transacción ya firmada por la wallet y espera a que el ledger la incluya.
 * `sendTransaction` solo devuelve PENDING: hay que consultar el resultado.
 */
async function submitSigned(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') throw new Error(`Stellar rechazó la transacción: ${sent.errorResult?.toXDR('base64') ?? 'sin detalle'}`);
  for (let i = 0; i < 30; i++) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === 'SUCCESS') return sent.hash;
    if (got.status === 'FAILED') throw new Error('la transacción falló en Stellar');
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Stellar tardó demasiado en confirmar; revisa el explorer');
}

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

/** Errores del API con mensaje humano; el resto se muestra tal cual. */
function humanError(e: unknown): string {
  if (e instanceof FlashApiError) {
    switch (e.code) {
      case 'BAD_NONCE': return 'Otro pago tuyo se adelantó. Vuelve a intentarlo.';
      case 'INSUFFICIENT_BALANCE': return 'No tienes saldo suficiente en Flash.';
      case 'INVALID_SIGNATURE': return 'La wallet firmó un mensaje distinto. Reintenta.';
      case 'TOKEN_NOT_ALLOWED': return 'Ese activo no está habilitado en este secuenciador.';
      default: return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

type Tab = 'deposit' | 'pay' | 'withdraw';
type Pending = { id: string; amount: bigint; proof: WithdrawalProofView | null };

export function Bridge() {
  const { health } = useHealth(6000);
  const [address, setAddress] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [flashBalance, setFlashBalance] = useState<bigint>(0n);
  const [l1Balance, setL1Balance] = useState<bigint | null>(null);
  const [balanceReady, setBalanceReady] = useState(false);
  const [tab, setTab] = useState<Tab>('deposit');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  useEffect(() => { void restoreWallet().then((a) => a && setAddress(a)); }, []);
  useEffect(() => { void flash.network().then((n: FlashNetworkInfo) => setToken(n.allowedTokens[0] ?? null)); }, []);

  const refresh = useCallback(async () => {
    if (!address || !token) return;
    try { setFlashBalance(await flash.getBalance(address, token)); setBalanceReady(true); } catch { /* reintenta */ }
    try {
      const res = await fetch(`${HORIZON}/accounts/${address}`);
      if (res.ok) {
        const acc = (await res.json()) as { balances: { asset_type: string; balance: string }[] };
        const native = acc.balances.find((b) => b.asset_type === 'native');
        setL1Balance(native ? BigInt(Math.round(Number(native.balance) * 1e7)) : 0n);
      } else if (res.status === 404) setL1Balance(0n);
    } catch { /* Horizon puede fallar: es informativo, no bloquea */ }
  }, [address, token]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Sigue los retiros pendientes hasta que el contrato deja reclamarlos.
  useEffect(() => {
    if (pending.length === 0) return;
    const tick = async () => {
      setPending(await Promise.all(pending.map(async (p) => {
        if (p.proof?.claimable) return p;
        try { return { ...p, proof: await flash.getWithdrawalProof(p.id) }; } catch { return p; }
      })));
    };
    const t = setInterval(() => void tick(), 4000);
    return () => clearInterval(t);
  }, [pending]);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label); setError(null); setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await refresh();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!address) return <Connect onConnect={(a) => setAddress(a)} health={health} />;

  return (
    <div className="min-h-dvh bg-paper font-sans text-ink">
      <AppNav badge="bridge" />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <p className="font-mono text-sm text-ink/50">{short(address)} · <a href="/account" className="underline">Account</a></p>
          <button
            onClick={() => void disconnectWallet().then(() => setAddress(null))}
            className="rounded-full border border-ink/15 px-4 py-2 font-mono text-sm transition hover:border-ink/40"
          >
            Disconnect
          </button>
        </div>

        <div className="grid gap-px overflow-hidden rounded-2xl border border-ink/12 bg-ink/10 sm:grid-cols-2">
          <div className="bg-white p-6">
            <div className="text-sm text-ink/50">On Flash</div>
            <div className="mt-1 font-mono text-3xl font-medium">{balanceReady ? fmtStroops(flashBalance) : '…'}</div>
            <div className="mt-1 text-sm text-ink/45">FXLM · instant</div>
          </div>
          <div className="bg-white p-6">
            <div className="text-sm text-ink/50">On Stellar</div>
            <div className="mt-1 font-mono text-3xl font-medium">{l1Balance === null ? '…' : fmtStroops(l1Balance)}</div>
            <div className="mt-1 text-sm text-ink/45">XLM · ~5 s per payment</div>
          </div>
        </div>

        <nav className="mt-8 flex gap-1 rounded-full border border-ink/12 bg-white p-1">
          {(['deposit', 'pay', 'withdraw'] as Tab[]).map((t) => (
            <button key={t} onClick={() => { setTab(t); setError(null); setNotice(null); }}
              className={`flex-1 rounded-full px-4 py-2.5 text-sm font-medium capitalize transition ${
                tab === t ? 'bg-ink text-white' : 'text-ink/60 hover:text-ink'}`}>
              {t}
            </button>
          ))}
        </nav>

        {error && <p className="mt-6 rounded-xl border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-800">{error}</p>}
        {notice && <p className="mt-6 rounded-xl border border-teal/40 bg-teal/5 px-5 py-4 text-sm text-ink">{notice}</p>}

        <div className="mt-6 rounded-2xl border border-ink/12 bg-white p-7">
          {tab === 'deposit' && <Deposit address={address} token={token} busy={busy} run={run} />}
          {tab === 'pay' && <Pay address={address} token={token} busy={busy} run={run} />}
          {tab === 'withdraw' && (
            <Withdraw address={address} token={token} busy={busy} run={run} pending={pending} setPending={setPending} />
          )}
        </div>

        <p className="mt-8 text-center text-xs text-ink/40">
          Testnet. Need an integration? <a href="/developers" className="underline">Developers</a> · <a href="/explorer" className="underline">Explorer</a>
        </p>
      </main>
    </div>
  );
}

function Connect({ onConnect, health }: { onConnect: (a: string) => void; health: ReturnType<typeof useHealth>['health'] }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-dvh bg-paper font-sans text-ink">
      <AppNav badge="bridge" />
      <div className="grid place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-8 font-display text-4xl font-semibold tracking-tight">Tu cuenta de Stellar, instantánea</h1>
        <p className="mt-4 leading-relaxed text-ink/60">
          Conecta la wallet que ya usas. No hay registro, ni contraseña, ni una llave nueva que
          guardar: tu dirección <code className="font-mono">G…</code> es tu cuenta en Flash.
        </p>
        <button
          onClick={() => { setBusy(true); setError(null); connectWallet().then(onConnect).catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); }}
          disabled={busy}
          className="mt-8 w-full rounded-full bg-ink py-3.5 font-medium text-white transition hover:bg-ink/90 disabled:opacity-50"
        >
          {busy ? 'Conectando…' : 'Conectar wallet'}
        </button>
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-8 flex justify-center"><StatusPill health={health} /></div>
        <p className="mt-6 text-sm text-ink/45"><a href="/developers" className="underline">Integrating an app?</a> · <a href="/account" className="underline">Account dashboard</a></p>
      </div>
      </div>
    </div>
  );
}

type RunFn = (label: string, fn: () => Promise<string | void>) => Promise<void>;

function Field({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink/70">{label}</span>
      <input {...props} className="mt-2 w-full rounded-xl border border-ink/15 px-4 py-3 font-mono text-sm outline-none transition focus:border-ink/50" />
      {hint && <span className="mt-1.5 block text-xs text-ink/45">{hint}</span>}
    </label>
  );
}

function Submit({ busy, label, children }: { busy: string | null; label: string; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={busy !== null}
      className="w-full rounded-full bg-gold py-3.5 font-semibold text-ink transition hover:bg-gold/90 disabled:opacity-50">
      {busy === label ? 'Firmando…' : children}
    </button>
  );
}

function Deposit({ address, token, busy, run }: { address: string; token: string | null; busy: string | null; run: RunFn }) {
  const [amount, setAmount] = useState('');
  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      void run('deposit', async () => {
        if (!token) throw new Error('el secuenciador aún no ha respondido');
        const tx = await flash.buildDepositTx({ server, from: address, token, amount: toStroops(amount) });
        const hash = await submitSigned(await signStellarTx(tx.toXDR(), address));
        return `Depósito enviado (${hash.slice(0, 12)}…). Aparecerá en tu saldo Flash en unos segundos.`;
      });
    }}>
      <p className="text-ink/65">
        Meter XLM en Flash es una transacción de Stellar: es el único paso que espera a un ledger,
        y solo lo haces al entrar.
      </p>
      <Field label="Cantidad" hint="XLM de testnet" inputMode="decimal" placeholder="10.0"
        value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Submit busy={busy} label="deposit">Depositar</Submit>
    </form>
  );
}

function Pay({ address, token, busy, run }: { address: string; token: string | null; busy: string | null; run: RunFn }) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      void run('pay', async () => {
        if (!token) throw new Error('el secuenciador aún no ha respondido');
        const { message, tx } = await flash.signingMessage({ type: 'transfer', from: address, to, token, amount: toStroops(amount) });
        const signature = await signFlashMessage(message, address);
        const receipt = await flash.submitSigned({ ...tx, signature });
        setLatency(receipt.latencyUs);
        setAmount('');
        return `Pagado. Confirmado en ${(receipt.latencyUs / 1000).toFixed(2)} ms.`;
      });
    }}>
      <p className="text-ink/65">
        Este pago no toca Stellar: se confirma dentro de Flash en milisegundos y se liquida
        después, en lote.
      </p>
      <Field label="Destinatario" hint="Cualquier dirección G… — no necesita registrarse ni activar nada"
        placeholder="GBXRLWDX…" value={to} onChange={(e) => setTo(e.target.value.trim())} />
      <Field label="Cantidad" hint="FXLM" inputMode="decimal" placeholder="2.5"
        value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Submit busy={busy} label="pay">Pagar ahora</Submit>
      {latency !== null && (
        <p className="rounded-xl bg-ink px-5 py-4 text-center font-mono text-sm text-gold">
          confirmado en {(latency / 1000).toFixed(2)} ms
        </p>
      )}
    </form>
  );
}

function Withdraw({ address, token, busy, run, pending, setPending }: {
  address: string; token: string | null; busy: string | null; run: RunFn;
  pending: Pending[]; setPending: React.Dispatch<React.SetStateAction<Pending[]>>;
}) {
  const [amount, setAmount] = useState('');
  return (
    <div className="space-y-7">
      <form className="space-y-5" onSubmit={(e) => {
        e.preventDefault();
        void run('withdraw', async () => {
          if (!token) throw new Error('el secuenciador aún no ha respondido');
          const stroops = toStroops(amount);
          const { message, tx } = await flash.signingMessage({ type: 'withdraw', from: address, token, amount: stroops, l1Recipient: address });
          const signature = await signFlashMessage(message, address);
          const receipt = await flash.submitSigned({ ...tx, signature });
          setPending((p) => [{ id: receipt.id, amount: stroops, proof: null }, ...p]);
          setAmount('');
          return 'Retiro pedido. Cuando pase el periodo de desafío podrás reclamarlo en Stellar.';
        });
      }}>
        <p className="text-ink/65">
          Salir quema tu FXLM y te deja reclamar el XLM en Stellar con una prueba Merkle. El contrato
          te paga a ti: nosotros no intervenimos y no podemos impedirlo.
        </p>
        <Field label="Cantidad" hint="FXLM a retirar" inputMode="decimal" placeholder="1.0"
          value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Submit busy={busy} label="withdraw">Pedir retiro</Submit>
      </form>

      {pending.length > 0 && (
        <div className="border-t border-ink/10 pt-6">
          <h3 className="font-display font-semibold">Retiros en curso</h3>
          <ul className="mt-4 space-y-3">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink/12 px-4 py-3">
                <div>
                  <div className="font-mono text-sm">{fmtStroops(p.amount)} XLM</div>
                  <div className="text-xs text-ink/45">
                    {!p.proof ? 'esperando al lote…'
                      : p.proof.claimable ? 'listo para reclamar'
                      : `lote #${p.proof.batchIndex} · ${p.proof.batchStatus} · esperando el periodo de desafío`}
                  </div>
                </div>
                <button
                  disabled={!p.proof?.claimable || busy !== null}
                  onClick={() => void run('claim', async () => {
                    const tx = await flash.buildWithdrawClaimTx({ server, source: address, proof: p.proof! });
                    await submitSigned(await signStellarTx(tx.toXDR(), address));
                    setPending((list) => list.filter((x) => x.id !== p.id));
                    return 'Reclamado. El XLM está de vuelta en tu cuenta de Stellar.';
                  })}
                  className="shrink-0 rounded-full bg-ink px-5 py-2 text-sm font-medium text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Reclamar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
