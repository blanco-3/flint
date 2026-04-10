#!/usr/bin/env node

const anchor = require("@coral-xyz/anchor");
const BN = require("bn.js");
const {
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const idl = require("../target/idl/flint.json");

const PROGRAM_ID = new PublicKey("5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt");
const MODE = process.argv[2] || "happy";

if (!["happy", "timeout"].includes(MODE)) {
  console.error("Usage: node scripts/demo.js [happy|timeout]");
  process.exit(1);
}

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);

let nonceCounter = BigInt(Date.now());
function nextNonce() {
  nonceCounter += 1n;
  return new BN(nonceCounter.toString());
}

function deriveConfigPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

function deriveIntentPda(userPubkey, nonce) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("intent"), userPubkey.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
}

function deriveBidPda(intentPda, solverPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), intentPda.toBuffer(), solverPubkey.toBuffer()],
    PROGRAM_ID
  )[0];
}

function deriveSolverRegistryPda(solverPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("solver"), solverPubkey.toBuffer()],
    PROGRAM_ID
  )[0];
}

async function airdrop(pubkey, lamports = 2e9) {
  const signature = await provider.connection.requestAirdrop(pubkey, lamports);
  await provider.connection.confirmTransaction(signature);
}

async function waitUntilSlotPassed(targetSlot) {
  let currentSlot = await provider.connection.getSlot();
  while (currentSlot <= targetSlot) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    currentSlot = await provider.connection.getSlot();
  }
  return currentSlot;
}

async function main() {
  const admin = provider.wallet.publicKey;
  const user = Keypair.generate();
  const solver = Keypair.generate();
  const configPda = deriveConfigPda();
  const solverRegistryPda = deriveSolverRegistryPda(solver.publicKey);
  const nonce = nextNonce();

  await airdrop(user.publicKey);
  await airdrop(solver.publicKey);

  const inputMint = await createMint(provider.connection, user, user.publicKey, null, 6);
  const outputMint = await createMint(provider.connection, solver, solver.publicKey, null, 6);

  const userInputAta = await createAssociatedTokenAccount(
    provider.connection,
    user,
    inputMint,
    user.publicKey
  );
  const solverInputAta = await createAssociatedTokenAccount(
    provider.connection,
    solver,
    inputMint,
    solver.publicKey
  );
  const solverOutputAta = await createAssociatedTokenAccount(
    provider.connection,
    solver,
    outputMint,
    solver.publicKey
  );
  const userOutputAta = await createAssociatedTokenAccount(
    provider.connection,
    user,
    outputMint,
    user.publicKey
  );

  await mintTo(provider.connection, user, inputMint, userInputAta, user, 1_000_000_000);
  await mintTo(provider.connection, solver, outputMint, solverOutputAta, solver, 2_000_000_000);

  console.log(`mode=${MODE}`);
  console.log(`user=${user.publicKey.toBase58()}`);
  console.log(`solver=${solver.publicKey.toBase58()}`);

  await program.methods
    .initializeConfig(admin, new BN(100))
    .accounts({
      admin,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const registerTx = await program.methods
    .registerSolver(new BN(100_000_000))
    .accounts({
      solver: solver.publicKey,
      solverRegistry: solverRegistryPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([solver])
    .rpc();
  console.log(`register_solver tx=${registerTx}`);

  const intentPda = deriveIntentPda(user.publicKey, nonce);
  const bidPda = deriveBidPda(intentPda, solver.publicKey);
  const escrowAta = await getAssociatedTokenAddress(inputMint, intentPda, true);

  const submitIntentTx = await program.methods
    .submitIntent(new BN(100_000_000), new BN(95_000_000), nonce)
    .accounts({
      user: user.publicKey,
      inputMint,
      outputMint,
      userTokenAccount: userInputAta,
      escrowTokenAccount: escrowAta,
      intent: intentPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([user])
    .rpc();
  console.log(`submit_intent tx=${submitIntentTx}`);

  const submitBidTx = await program.methods
    .submitBid(new BN(98_000_000))
    .accounts({
      solver: solver.publicKey,
      solverRegistry: solverRegistryPda,
      intent: intentPda,
      bid: bidPda,
      previousWinningBid: null,
      previousSolverRegistry: null,
      systemProgram: SystemProgram.programId,
    })
    .signers([solver])
    .rpc();
  console.log(`submit_bid tx=${submitBidTx}`);

  const intentAccount = await program.account.intentAccount.fetch(intentPda);
  const closeAtSlot = intentAccount.closeAtSlot.toNumber();

  if (MODE === "happy") {
    await waitUntilSlotPassed(closeAtSlot);
    const settleTx = await program.methods
      .settleAuction()
      .accounts({
        solver: solver.publicKey,
        intent: intentPda,
        winningBid: bidPda,
        solverRegistry: solverRegistryPda,
        escrowTokenAccount: escrowAta,
        solverInputTokenAccount: solverInputAta,
        solverOutputTokenAccount: solverOutputAta,
        userOutputTokenAccount: userOutputAta,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();
    console.log(`settle_auction tx=${settleTx}`);
  } else {
    await waitUntilSlotPassed(closeAtSlot + 10);
    const refundTx = await program.methods
      .refundAfterTimeout()
      .accounts({
        caller: admin,
        solver: solver.publicKey,
        solverRegistry: solverRegistryPda,
        intent: intentPda,
        winningBid: bidPda,
        escrowTokenAccount: escrowAta,
        userTokenAccount: userInputAta,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`refund_after_timeout tx=${refundTx}`);
  }

  const userInputBalance = await provider.connection.getTokenAccountBalance(userInputAta);
  const userOutputBalance = await provider.connection.getTokenAccountBalance(userOutputAta);
  const solverInputBalance = await provider.connection.getTokenAccountBalance(solverInputAta);
  const solverOutputBalance = await provider.connection.getTokenAccountBalance(solverOutputAta);

  console.log(`user input=${userInputBalance.value.amount}`);
  console.log(`user output=${userOutputBalance.value.amount}`);
  console.log(`solver input=${solverInputBalance.value.amount}`);
  console.log(`solver output=${solverOutputBalance.value.amount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
