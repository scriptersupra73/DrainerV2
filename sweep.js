import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferInstruction, createCloseAccountInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

const RPC = process.env.RPC;
const COLD = process.env.COLD;
const conn = new Connection(RPC, 'confirmed');
const kp = Keypair.fromSecretKey(bs58.decode(process.env.SECRET));

const JUP = 'https://lite-api.jup.ag/swap/v1';
const SOL = 'So11111111111111111111111111111111111111112';

async function sweep() {
  const { value: accounts } = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID });

  for (const { pubkey: ata, account } of accounts) {
    const info = account.data.parsed.info;
    const raw = BigInt(info.tokenAmount.amount);
    if (raw === 0n) { await close(ata); continue; }

    try {
      const q = await fetch(`${JUP}/quote?inputMint=${info.mint}&outputMint=${SOL}&amount=${raw}&slippageBps=800`).then(r => r.json());
      if (!q?.outAmount || Number(q.outAmount) < 1e5) { await sendToken(ata, info.mint, raw); continue; }

      const sw = await fetch(`${JUP}/swap`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quoteResponse: q, userPublicKey: kp.publicKey.toString(),
          wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true })
      }).then(r => r.json());

      const tx = Transaction.from(Buffer.from(sw.swapTransaction, 'base64'));
      tx.partialSign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await conn.confirmTransaction(sig, 'confirmed');
      await close(ata);
    } catch (e) { console.log('skip', info.mint, e.message); }
  }
  await flush();
}

async function sendToken(ata, mint, raw) {
  const dest = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(COLD));
  const tx = new Transaction()
    .add(createTransferInstruction(ata, dest, kp.publicKey, raw));
  const sig = await conn.sendRawTransaction(tx, [kp], { skipPreflight: true });
  await conn.confirmTransaction(sig, 'confirmed');
}

async function close(ata) {
  try {
    const tx = new Transaction().add(createCloseAccountInstruction(ata, kp.publicKey, kp.publicKey));
    await conn.sendRawTransaction(tx, [kp], { skipPreflight: true });
  } catch {}
}

async function flush() {
  const bal = await conn.getBalance(kp.publicKey);
  if (bal < 20000) return;
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(COLD), lamports: bal - 5000 }));
  await conn.sendRawTransaction(tx, [kp], { skipPreflight: true });
}

sweep();
