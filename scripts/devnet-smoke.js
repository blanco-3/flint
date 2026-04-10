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
const {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const { createRequire } = require("module");

const requireFromModule = createRequire(__filename);
const idl = requireFromModule("../target/idl/flint.json");

const PROGRAM_ID = new PublicKey("5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt");
const MODE = process.argv[2] || "happy";
const FUND_USER_LAMPORTS = 100_000_000;
const FUND_SOLVER_LAMPORTS = 250_000_000;

if (!["happy", "timeout"].includes(MODE)) {
  console.error("Usage: node scripts/devnet-smoke.js [happy|timeout]");
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

async function ensureConfig() {
  const configPda = deriveConfigPda();
  const existing = await program.account.configAccount.fetchNullable(configPda);

  if (!existing) {
    await program.methods
      .initializeConfig(provider.wallet.publicKey, new BN(100))
      .accounts({
        admin: provider.wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  return configPda;
}

async function fundTempAccount(recipient, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  return provider.sendAndConfirm(tx, []);
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
  const nonce = nextNonce();

  const configPda = await ensureConfig();
  const solverRegistryPda = deriveSolverRegistryPda(solver.publicKey);

  await fundTempAccount(user.publicKey, FUND_USER_LAMPORTS);
  await fundTempAccount(solver.publicKey, FUND_SOLVER_LAMPORTS);

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

  const registerSignature = await program.methods
    .registerSolver(new BN(100_000_000))
    .accounts({
      solver: solver.publicKey,
      solverRegistry: solverRegistryPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([solver])
    .rpc();

  const intentPda = deriveIntentPda(user.publicKey, nonce);
  const bidPda = deriveBidPda(intentPda, solver.publicKey);
  const escrowAta = await getAssociatedTokenAddress(inputMint, intentPda, true);

  const submitIntentSignature = await program.methods
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

  const submitBidSignature = await program.methods
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

  const intentAccount = await program.account.intentAccount.fetch(intentPda);
  const closeAtSlot = intentAccount.closeAtSlot.toNumber();

  let terminalSignature;
  if (MODE === "happy") {
    await waitUntilSlotPassed(closeAtSlot);
    terminalSignature = await program.methods
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
  } else {
    await waitUntilSlotPassed(closeAtSlot + 10);
    terminalSignature = await program.methods
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
  }

  const payload = {
    mode: MODE,
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    configPda: configPda.toBase58(),
    user: user.publicKey.toBase58(),
    solver: solver.publicKey.toBase58(),
    solverRegistry: solverRegistryPda.toBase58(),
    intent: intentPda.toBase58(),
    winningBid: bidPda.toBase58(),
    registerSignature,
    submitIntentSignature,
    submitBidSignature,
    terminalSignature,
    terminalExplorer: `https://explorer.solana.com/tx/${terminalSignature}?cluster=devnet`,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
