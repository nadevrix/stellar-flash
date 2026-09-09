import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { L2Tx } from '@flash/protocol';
import { Alert, BtnPrimary, Card, PageHeader, StatTile } from '../components/ui/Lab.tsx';
import { fetchBatch, fetchHealth, SEQUENCER_URL, type Health } from '../lib/api.ts';
import { EXPERT, ago, fmtStroops, short } from '../lib/format.ts';
import { decodeBatchTxs, idForTx, verifyFromGenesis } from '../lib/verify.ts';

function who(tx: L2Tx): string {
  if (tx.type === 'deposit') return tx.to;
  if (tx.type === 'transfer') return `${short(tx.from, 4)} → ${short(tx.to, 4)}`;
  return tx.from;
}

export function BatchDetail() {
  const { index } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchBatch>> | null>(null);
  const [txs, setTxs] = useState<L2Tx[] | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    void fetchHealth().then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    if (!index) return;
    const load = () => {
      void fetchBatch(index, true).then((d) => {
        setData(d);
        if (d.batch.txData) {
          try {
            setTxs(decodeBatchTxs(d.batch.txData));
            setDecodeError(null);
          } catch (e) {
            setTxs(null);
            setDecodeError(e instanceof Error ? e.message : String(e));
          }
        }
      }).catch(() => setData(null));
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [index]);

  const b = data?.batch;
  const domain = health?.network;

  const onVerify = async () => {
    if (!index) return;
    setVerifying(true);
    setVerifyMsg(null);
    setVerifyOk(null);
    try {
      const res = await verifyFromGenesis(index);
      if (res.ok) {
        setVerifyOk(true);
        setVerifyMsg(`Replayed ${res.batches} batches from genesis. State root matches. ${res.accounts} accounts.`);
      } else {
        setVerifyOk(false);
        setVerifyMsg(res.batchIndex ? `#${res.batchIndex}: ${res.error}` : res.error);
      }
    } catch (e) {
      setVerifyOk(false);
      setVerifyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/explorer" className="text-sm text-muted hover:text-lab-purple">← Transactions</Link>
      <PageHeader
        eyebrow="Batch"
        title={`Batch #${index ?? ''}`}
        description="Transaction data is on Stellar. Replay it here — you do not have to trust the sequencer."
      />
      {!b && <p className="text-muted">Loading…</p>}
      {b && (
        <div className="space-y-6">
          <Card className="grid overflow-hidden sm:grid-cols-2">
            <StatTile label="Status" value={b.status} />
            <div className="border-t border-border sm:border-t-0 sm:border-l"><StatTile label="Transactions" value={String(b.txCount)} /></div>
            <div className="border-t border-border sm:border-t-0 sm:border-l"><StatTile label="Data size" value={`${b.txDataBytes} B`} /></div>
            <div className="border-t border-border sm:border-t-0 sm:border-l"><StatTile label="Sealed" value={`${ago(b.sealedAt)} ago`} /></div>
          </Card>
          <Card className="p-5 font-mono text-xs break-all">
            <div className="text-muted">State root</div>
            <div className="mt-1">{b.newStateRoot}</div>
          </Card>
          {b.l1TxHash ? (
            <a href={EXPERT.tx(b.l1TxHash)} target="_blank" rel="noreferrer"
              className="inline-block rounded-lg border border-border px-5 py-2 text-sm text-lab-purple hover:bg-surface">
              View on stellar.expert →
            </a>
          ) : (
            <p className="text-sm text-muted">Waiting for Stellar L1…</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <BtnPrimary onClick={() => void onVerify()} disabled={verifying}>
              {verifying ? 'Replaying…' : 'Verify from genesis'}
            </BtnPrimary>
            <span className="text-xs text-muted">Replays every batch up to this one in your browser.</span>
          </div>
          {verifyMsg && (
            <Alert tone={verifyOk ? 'success' : 'error'}>{verifyMsg}</Alert>
          )}

          {decodeError && <Alert tone="error">Could not decode batch data: {decodeError}</Alert>}

          {txs && txs.length > 0 && (
            <Card>
              <div className="border-b border-border px-5 py-4 text-sm font-semibold">Transactions in this batch</div>
              <ul className="divide-y divide-border">
                {txs.map((tx, i) => {
                  const id = domain ? idForTx(tx, domain.passphrase, domain.bridgeContractId) : null;
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <span className="capitalize text-muted">{tx.type}</span>
                        {' '}
                        {id ? (
                          <Link to={`/tx/${id}`} className="font-mono text-lab-purple underline">{short(who(tx), 4)}</Link>
                        ) : (
                          <span className="font-mono">{short(who(tx), 4)}</span>
                        )}
                      </div>
                      <span className="font-mono tabular-nums">{fmtStroops(tx.amount)}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {data!.withdrawals.length > 0 && (
            <Card>
              <div className="border-b border-border px-5 py-4 text-sm font-semibold">Withdrawals in batch</div>
              <ul className="divide-y divide-border">
                {data!.withdrawals.map((w) => (
                  <li key={w.txId} className="flex justify-between px-5 py-3 font-mono text-sm">
                    <Link to={`/tx/${w.txId}`} className="text-lab-purple underline">{w.txId.slice(0, 12)}…</Link>
                    <span>{fmtStroops(w.amount)} → {w.recipient.slice(0, 8)}…</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <a href={`${SEQUENCER_URL}/v1/batches/${index}?data=1`} target="_blank" rel="noreferrer"
            className="text-xs text-muted underline">Download batch data (JSON)</a>
        </div>
      )}
    </div>
  );
}
