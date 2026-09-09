import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Asset, Horizon, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { FlashApiError, FlashClient, type FlashOnrampInfo, type WithdrawalProofView } from '@flash/sdk';
import { useHealth } from '../components/LiveStatus.tsx';
import { Alert, BtnPrimary, BtnSecondary, Card, LabInput, PageHeader, Segmented, StatTile } from '../components/ui/Lab.tsx';
import { useWallet } from '../context/WalletContext.tsx';
import { SEQUENCER_URL, XLM_TESTNET, fetchAccount, type Health } from '../lib/api.ts';
import { EXPERT, fmtStroops, toHorizonAmount, toStroops } from '../lib/format.ts';
import { signFlashMessage, signStellarTx } from '../lib/wallet.ts';

const HORIZON_FALLBACK = 'https://horizon-testnet.stellar.org';

const flash = new FlashClient({ baseUrl: SEQUENCER_URL });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST a Horizon: devuelve el hash en cuanto la red acepta la tx. El SDK a veces se queda esperando. */
async function submitHorizon(horizonUrl: string, signedXdr: string): Promise<string> {
  const res = await fetch(`${horizonUrl.replace(/\/$/, '')}/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: signedXdr }),
  });
  const body = (await res.json()) as {
    hash?: string;
    title?: string;
    detail?: string;
    extras?: { result_codes?: { transaction?: string } };
  };
  if (!res.ok || !body.hash) {
    const code = body.extras?.result_codes?.transaction;
    throw new Error(code ? `Stellar rejected the payment (${code}).` : (body.detail || body.title || `Horizon HTTP ${res.status}`));
  }
  return body.hash;
}

function balanceOf(acc: { balances: { token: string; balance: string }[] }, token: string): bigint {
  return BigInt(acc.balances.find((b) => b.token === token)?.balance ?? '0');
}

function humanError(e: unknown): string {
  if (e instanceof FlashApiError) {
    switch (e.code) {
      case 'BAD_NONCE': return 'Another payment of yours landed first. Try again.';
      case 'INSUFFICIENT_BALANCE': return 'Not enough Flash balance.';
      case 'SELF_TRANSFER': return 'You cannot pay yourself. Use another G… address.';
      case 'INVALID_SIGNATURE': return 'The wallet signed a different message. Try again.';
      case 'TOKEN_NOT_ALLOWED': return 'That asset is not enabled on this sequencer.';
      default: return e.message;
    }
  }
  if (e && typeof e === 'object' && 'response' in e) {
    const res = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string } }; title?: string; detail?: string } } }).response?.data;
    const code = res?.extras?.result_codes?.transaction;
    if (code) return `Stellar rejected the payment (${code}).`;
    if (res?.detail) return res.detail;
    if (res?.title) return res.title;
  }
  return e instanceof Error ? e.message : String(e);
}

type Tab = 'deposit' | 'pay' | 'withdraw';
type Pending = { id: string; amount: bigint; proof: WithdrawalProofView | null };
type RunFn = (label: string, fn: () => Promise<string | void>) => Promise<void>;

function onrampFromHealth(h: Health | null): FlashOnrampInfo | null {
  if (!h) return null;
  const raw = h.network.onramp;
  const token = raw?.token ?? h.network.allowedTokens?.[0] ?? XLM_TESTNET;
  if (raw?.enabled && raw.address?.startsWith('G')) {
    return { enabled: true, address: raw.address, horizonUrl: raw.horizonUrl || HORIZON_FALLBACK, minAmount: raw.minAmount, token, autoclaim: raw.autoclaim };
  }
  const addr = h.network.sequencerAccount;
  if (h.network.l1Mode === 'rpc' && addr?.startsWith('G')) {
    return { enabled: true, address: addr, horizonUrl: HORIZON_FALLBACK, minAmount: '10000', token, autoclaim: true };
  }
  return null;
}

export function Bridge() {
  const { address, connect, connecting } = useWallet();
  const { health } = useHealth(4000);
  const onramp = onrampFromHealth(health);
  const token = onramp?.token ?? health?.network.allowedTokens?.[0] ?? XLM_TESTNET;
  const [flashBalance, setFlashBalance] = useState<bigint>(0n);
  const [l1Balance, setL1Balance] = useState<bigint | null>(null);
  const [balanceReady, setBalanceReady] = useState(false);
  const [tab, setTab] = useState<Tab>('deposit');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  const refresh = useCallback(async () => {
    if (!address || !token) return;
    try {
      const acc = await fetchAccount(address);
      setFlashBalance(balanceOf(acc, token));
      setBalanceReady(true);
    } catch { /* reintenta */ }
    try {
      const res = await fetch(`${onramp?.horizonUrl ?? HORIZON_FALLBACK}/accounts/${address}`);
      if (res.ok) {
        const acc = (await res.json()) as { balances: { asset_type: string; balance: string }[] };
        const native = acc.balances.find((b) => b.asset_type === 'native');
        setL1Balance(native ? BigInt(Math.round(Number(native.balance) * 1e7)) : 0n);
      } else if (res.status === 404) setL1Balance(0n);
    } catch { /* informativo */ }
  }, [address, token, onramp?.horizonUrl]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (pending.length === 0) return;
    const tick = async () => {
      setPending(await Promise.all(pending.map(async (p) => {
        if (p.proof?.claimed) return p;
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
          title="FXLM at bullet speed"
          description="Send ordinary testnet XLM. We lock it in the vault and credit FXLM. After that, payments confirm in milliseconds — you never talk to a Soroban RPC."
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
        description="Pay with FXLM instantly. Entering and leaving are normal Stellar payments — we talk to Soroban, you don't."
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
        {tab === 'deposit' && <Deposit address={address} token={token} onramp={onramp} healthReady={health !== null} flashBalance={flashBalance} busy={busy} setBusy={setBusy} run={run} />}
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

function CopyAddr({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-paper px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{value}</code>
      <BtnSecondary type="button" className="shrink-0 px-3 py-1 text-xs" onClick={() => {
        void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
      }}>{copied ? 'Copied' : 'Copy'}</BtnSecondary>
    </div>
  );
}

function Deposit({ address, token, onramp, healthReady, flashBalance, busy, setBusy, run }: {
  address: string; token: string; onramp: FlashOnrampInfo | null; healthReady: boolean; flashBalance: bigint; busy: string | null;
  setBusy: (v: string | null) => void; run: RunFn;
}) {
  const [amount, setAmount] = useState('');
  if (!healthReady) {
    return <p className="text-sm text-muted">Checking the sequencer…</p>;
  }
  if (!onramp?.enabled || !onramp.address) {
    return (
      <p className="text-sm leading-relaxed text-muted">
        This sequencer is not taking classic deposits yet (mock mode, or onramp disabled). On the public
        testnet you send ordinary XLM — Flash converts it to FXLM.
      </p>
    );
  }
  const horizonUrl = onramp.horizonUrl || HORIZON_FALLBACK;
  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      void run('sign', async () => {
        if (!token) throw new Error('Sequencer is not responding.');
        const stroops = toStroops(amount);
        if (stroops < BigInt(onramp.minAmount)) {
          throw new Error(`Minimum deposit is ${fmtStroops(onramp.minAmount)} XLM.`);
        }
        const horizon = new Horizon.Server(horizonUrl);
        const account = await horizon.loadAccount(address);
        const fee = String(await horizon.fetchBaseFee());
        const tx = new TransactionBuilder(account, { fee, networkPassphrase: Networks.TESTNET })
          .addOperation(Operation.payment({ destination: onramp.address, asset: Asset.native(), amount: toHorizonAmount(amount) }))
          .setTimeout(60)
          .build();
        const signed = await signStellarTx(tx.toXDR(), address);
        setBusy('send');
        const hash = await submitHorizon(horizonUrl, signed);
        setBusy('credit');
        const before = flashBalance;
        for (let i = 0; i < 30; i++) {
          await sleep(1500);
          try {
            const acc = await fetchAccount(address);
            const bal = balanceOf(acc, token);
            if (bal > before) return `FXLM credited. Your Stellar payment was ${hash.slice(0, 12)}…`;
          } catch { /* sequencer catching up */ }
          try {
            const r = await fetch(`${SEQUENCER_URL}/v1/onramp?account=${address}`);
            if (r.ok) {
              const body = (await r.json()) as { payments?: { txHash: string; status: string; error?: string | null }[] };
              const p = body.payments?.find((x) => x.txHash.toLowerCase() === hash.toLowerCase());
              if (p?.status === 'failed') throw new Error(p.error || 'We could not lock this payment in the vault. It will be retried.');
              if (p?.status === 'skipped') throw new Error('Amount below the minimum; the XLM stayed in the sequencer account.');
              if (p?.status === 'deposited') {
                const acc = await fetchAccount(address);
                if (balanceOf(acc, token) > before) return `FXLM credited. Your Stellar payment was ${hash.slice(0, 12)}…`;
              }
            }
          } catch (err) {
            if (err instanceof Error && err.message !== 'Failed to fetch') throw err;
          }
        }
        return `Payment landed on Stellar (${hash.slice(0, 12)}…). FXLM usually shows within a minute — check Account.`;
      });
    }}>
      <p className="text-sm leading-relaxed text-muted">
        This is a <strong className="text-ink">normal XLM payment</strong> on Horizon — the same thing Lobstr or Freighter does every day.
        We lock it in the vault and credit FXLM 1:1. You do not call a contract, and you do not pick an RPC.
      </p>
      <div>
        <div className="mb-1 text-xs font-medium text-muted">Send to (Flash operator)</div>
        <CopyAddr value={onramp.address} />
        <a href={EXPERT.account(onramp.address)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-lab-purple underline">View on Stellar Expert</a>
      </div>
      <LabInput label="Amount" hint="Testnet XLM · we convert it to FXLM" inputMode="decimal" placeholder="10.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <BtnPrimary type="submit" disabled={busy !== null} className="w-full">
        {busy === 'sign' ? 'Sign in the wallet…'
          : busy === 'send' ? 'Sending XLM…'
            : busy === 'credit' ? 'Crediting FXLM…'
              : 'Send XLM → FXLM'}
      </BtnPrimary>
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
        if (!token) throw new Error('Sequencer is not responding.');
        const { message, tx } = await flash.signingMessage({ type: 'transfer', from: address, to, token, amount: toStroops(amount) });
        const signature = await signFlashMessage(message, address);
        const receipt = await flash.submitSigned({ ...tx, signature });
        setLatency(receipt.latencyUs);
        setAmount('');
        return `Paid. Confirmed in ${(receipt.latencyUs / 1000).toFixed(2)} ms.`;
      });
    }}>
      <p className="text-sm leading-relaxed text-muted">
        This never touches Stellar: it confirms inside Flash in milliseconds. It must go to <strong>another</strong> G… address (not yourself).
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

function withdrawStatus(p: Pending): string {
  if (p.proof?.claimed) return 'XLM sent to your Stellar account';
  if (p.proof?.claimable) return 'batch finalized · we are paying you on Stellar';
  if (!p.proof) return 'waiting for batch…';
  return `batch #${p.proof.batchIndex} · ${p.proof.batchStatus}`;
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
          if (!token) throw new Error('Sequencer is not responding.');
          const stroops = toStroops(amount);
          const { message, tx } = await flash.signingMessage({ type: 'withdraw', from: address, token, amount: stroops, l1Recipient: address });
          const signature = await signFlashMessage(message, address);
          const receipt = await flash.submitSigned({ ...tx, signature });
          setPending((p) => [{ id: receipt.id, amount: stroops, proof: null }, ...p]);
          setAmount('');
          return 'FXLM burned. After the challenge period we send XLM to your Stellar account — no contract call in your wallet.';
        });
      }}>
        <p className="text-sm leading-relaxed text-muted">
          Leaving burns FXLM. We wait for the batch to finalize, then we claim the vault and pay you XLM.
          You do not sign a Soroban transaction.
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
                  <div className="text-xs text-muted">{withdrawStatus(p)}</div>
                </div>
                {p.proof?.claimTxHash && (
                  <a href={EXPERT.tx(p.proof.claimTxHash)} target="_blank" rel="noreferrer" className="text-xs text-lab-purple underline">L1 tx</a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
