import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Networks, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { FlashApiError, FlashClient, type FlashNetworkInfo, type WithdrawalProofView } from '@flash/sdk';
import { Alert, BtnPrimary, Card, LabInput, PageHeader, Segmented, StatTile } from '../components/ui/Lab.tsx';
import { useWallet } from '../context/WalletContext.tsx';
import { SEQUENCER_URL } from '../lib/api.ts';
import { fmtStroops, toStroops } from '../lib/format.ts';
import { signFlashMessage, signStellarTx } from '../lib/wallet.ts';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON = 'https://horizon-testnet.stellar.org';

const flash = new FlashClient({ baseUrl: SEQUENCER_URL });
const server = new rpc.Server(RPC_URL);

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

function humanError(e: unknown): string {
  if (e instanceof FlashApiError) {
    switch (e.code) {
      case 'BAD_NONCE': return 'Otro pago tuyo se adelantó. Vuelve a intentarlo.';
      case 'INSUFFICIENT_BALANCE': return 'No tienes saldo suficiente en Flash.';
      case 'SELF_TRANSFER': return 'No puedes pagarte a ti mismo. Usa otra dirección G….';
      case 'INVALID_SIGNATURE': return 'La wallet firmó un mensaje distinto. Reintenta.';
      case 'TOKEN_NOT_ALLOWED': return 'Ese activo no está habilitado en este secuenciador.';
      default: return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

type Tab = 'deposit' | 'pay' | 'withdraw';
type Pending = { id: string; amount: bigint; proof: WithdrawalProofView | null };
type RunFn = (label: string, fn: () => Promise<string | void>) => Promise<void>;

export function Bridge() {
  const { address, connect, connecting } = useWallet();
  const [token, setToken] = useState<string | null>(null);
  const [flashBalance, setFlashBalance] = useState<bigint>(0n);
  const [l1Balance, setL1Balance] = useState<bigint | null>(null);
  const [balanceReady, setBalanceReady] = useState(false);
  const [tab, setTab] = useState<Tab>('deposit');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

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
    } catch { /* informativo */ }
  }, [address, token]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

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

  if (!address) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow="Bridge"
          title="Deposit, pay, withdraw"
          description="Connect your Stellar wallet to move XLM into Flash, pay anyone instantly, or withdraw back to Stellar. Same G… address — no signup."
        />
        <Card className="p-8 text-center">
          <p className="text-muted">Use the <strong className="text-ink">Connect wallet</strong> button in the header, or click below.</p>
          <BtnPrimary className="mt-6" onClick={() => void connect()} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </BtnPrimary>
          <p className="mt-6 text-sm text-muted">Freighter · xBull · Lobstr · Albedo · Hana · Rabet · testnet only</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Bridge"
        title="Move funds on Flash"
        description="Deposit is a Stellar transaction (~5 s). Pay and withdraw confirm inside Flash in milliseconds."
      />

      <Card className="mb-6 grid overflow-hidden sm:grid-cols-2">
        <StatTile label="On Flash · FXLM · instant" value={balanceReady ? fmtStroops(flashBalance) : '—'} />
        <div className="border-t border-border sm:border-t-0 sm:border-l">
          <StatTile label="On Stellar · XLM · ~5 s" value={l1Balance === null ? '—' : fmtStroops(l1Balance)} />
        </div>
      </Card>

      <div className="mb-6">
        <Segmented value={tab} onChange={(t) => { setTab(t); setError(null); setNotice(null); }}
          options={[{ id: 'deposit', label: 'Deposit' }, { id: 'pay', label: 'Pay' }, { id: 'withdraw', label: 'Withdraw' }]} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card className="mt-6 p-6">
        {tab === 'deposit' && <Deposit address={address} token={token} busy={busy} run={run} />}
        {tab === 'pay' && <Pay address={address} token={token} busy={busy} run={run} />}
        {tab === 'withdraw' && <Withdraw address={address} token={token} busy={busy} run={run} pending={pending} setPending={setPending} />}
      </Card>

      <p className="mt-6 text-center text-xs text-muted">
        Balances also on <Link to="/account" className="text-lab-purple underline">Account</Link>
        {' · '}<Link to="/explorer" className="text-lab-purple underline">Transactions</Link>
      </p>
    </div>
  );
}

function Deposit({ address, token, busy, run }: { address: string; token: string | null; busy: string | null; run: RunFn }) {
  const [amount, setAmount] = useState('');
  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      void run('deposit', async () => {
        if (!token) throw new Error('El secuenciador no responde. Reinícialo en Render.');
        const tx = await flash.buildDepositTx({ server, from: address, token, amount: toStroops(amount) });
        const hash = await submitSigned(await signStellarTx(tx.toXDR(), address));
        return `Depósito enviado (${hash.slice(0, 12)}…). Aparecerá en tu saldo Flash en unos segundos.`;
      });
    }}>
      <p className="text-sm leading-relaxed text-muted">
        Meter XLM en Flash es una transacción de Stellar: es el único paso que espera a un ledger, y solo lo haces al entrar.
      </p>
      <LabInput label="Amount" hint="Testnet XLM" inputMode="decimal" placeholder="10.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <BtnPrimary type="submit" disabled={busy !== null} className="w-full">{busy === 'deposit' ? 'Signing…' : 'Deposit'}</BtnPrimary>
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
        if (!token) throw new Error('El secuenciador no responde.');
        const { message, tx } = await flash.signingMessage({ type: 'transfer', from: address, to, token, amount: toStroops(amount) });
        const signature = await signFlashMessage(message, address);
        const receipt = await flash.submitSigned({ ...tx, signature });
        setLatency(receipt.latencyUs);
        setAmount('');
        return `Pagado. Confirmado en ${(receipt.latencyUs / 1000).toFixed(2)} ms.`;
      });
    }}>
      <p className="text-sm leading-relaxed text-muted">
        Este pago no toca Stellar: se confirma dentro de Flash en milisegundos. Debe ser a <strong>otra</strong> dirección G… (no a ti mismo).
      </p>
      <LabInput label="Recipient" hint="Any G… address — no registration needed" placeholder="GBXRLWDX…" value={to} onChange={(e) => setTo(e.target.value.trim())} />
      <LabInput label="Amount" hint="FXLM" inputMode="decimal" placeholder="2.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <BtnPrimary type="submit" disabled={busy !== null} className="w-full">{busy === 'pay' ? 'Signing…' : 'Pay now'}</BtnPrimary>
      {latency !== null && (
        <p className="rounded-lg bg-lab-purple/10 px-4 py-3 text-center font-mono text-sm text-lab-purple">
          confirmed in {(latency / 1000).toFixed(2)} ms
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
          if (!token) throw new Error('El secuenciador no responde.');
          const stroops = toStroops(amount);
          const { message, tx } = await flash.signingMessage({ type: 'withdraw', from: address, token, amount: stroops, l1Recipient: address });
          const signature = await signFlashMessage(message, address);
          const receipt = await flash.submitSigned({ ...tx, signature });
          setPending((p) => [{ id: receipt.id, amount: stroops, proof: null }, ...p]);
          setAmount('');
          return 'Retiro pedido. Cuando pase el periodo de desafío podrás reclamarlo en Stellar.';
        });
      }}>
        <p className="text-sm leading-relaxed text-muted">
          Salir quema tu FXLM y te deja reclamar el XLM en Stellar con una prueba Merkle.
        </p>
        <LabInput label="Amount" hint="FXLM to withdraw" inputMode="decimal" placeholder="1.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <BtnPrimary type="submit" disabled={busy !== null} className="w-full">{busy === 'withdraw' ? 'Signing…' : 'Request withdrawal'}</BtnPrimary>
      </form>

      {pending.length > 0 && (
        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Pending withdrawals</h3>
          <ul className="mt-4 space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                <div>
                  <div className="font-mono text-sm">{fmtStroops(p.amount)} XLM</div>
                  <div className="text-xs text-muted">
                    {!p.proof ? 'waiting for batch…'
                      : p.proof.claimable ? 'ready to claim'
                      : `batch #${p.proof.batchIndex} · ${p.proof.batchStatus}`}
                  </div>
                </div>
                <BtnPrimary
                  disabled={!p.proof?.claimable || busy !== null}
                  onClick={() => void run('claim', async () => {
                    const tx = await flash.buildWithdrawClaimTx({ server, source: address, proof: p.proof! });
                    await submitSigned(await signStellarTx(tx.toXDR(), address));
                    setPending((list) => list.filter((x) => x.id !== p.id));
                    return 'Reclamado. El XLM está de vuelta en tu cuenta de Stellar.';
                  })}
                >
                  Claim
                </BtnPrimary>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
