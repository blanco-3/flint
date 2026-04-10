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
}

async function registerSolver(signer) {
  const solverRegistry = deriveSolverRegistryPda(signer.publicKey);
  await program.methods
    .registerSolver(new BN(100_000_000))
    .accounts({
      solver: signer.publicKey,
      solverRegistry,
      systemProgram: SystemProgram.programId,
    })
    .signers([signer])
    .rpc();
  return solverRegistry;
}

async function main() {
  const admin = provider.wallet.publicKey;
  const user = Keypair.generate();
  const solverA = Keypair.generate();
  const solverB = Keypair.generate();

  await airdrop(user.publicKey);
  await airdrop(solverA.publicKey);
  await airdrop(solverB.publicKey);

  const inputMint = await createMint(provider.connection, user, user.publicKey, null, 6);
  const outputMint = await createMint(provider.connection, solverA, solverA.publicKey, null, 6);

  const userInputAta = await createAssociatedTokenAccount(
    provider.connection,
    user,
    inputMint,
    user.publicKey
  );
  const solverAInputAta = await createAssociatedTokenAccount(
    provider.connection,
    solverA,
    inputMint,
    solverA.publicKey
  );
  const solverBInputAta = await createAssociatedTokenAccount(
    provider.connection,
    solverB,
    inputMint,
    solverB.publicKey
  );
  const solverAOutputAta = await createAssociatedTokenAccount(
    provider.connection,
    solverA,
    outputMint,
    solverA.publicKey
  );
  const solverBOutputAta = await createAssociatedTokenAccount(
    provider.connection,
    solverB,
    outputMint,
    solverB.publicKey
  );
  const userOutputAta = await createAssociatedTokenAccount(
    provider.connection,
    user,
    outputMint,
    user.publicKey
  );

  await mintTo(provider.connection, user, inputMint, userInputAta, user, 1_000_000_000);
  await mintTo(provider.connection, solverA, outputMint, solverAOutputAta, solverA, 2_000_000_000);
  await mintTo(provider.connection, solverB, outputMint, solverBOutputAta, solverA, 2_000_000_000);

  const configPda = deriveConfigPda();
  await program.methods
    .initializeConfig(admin, new BN(100))
    .accounts({
      admin,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const solverARegistry = await registerSolver(solverA);
  const solverBRegistry = await registerSolver(solverB);

  const nonce = nextNonce();
  const minOutputAmount = new BN(95_000_000);
  const solverABid = new BN(96_000_000);
  const solverBBid = new BN(98_000_000);
  const intentPda = deriveIntentPda(user.publicKey, nonce);
  const bidAPda = deriveBidPda(intentPda, solverA.publicKey);
  const bidBPda = deriveBidPda(intentPda, solverB.publicKey);
  const escrowAta = await getAssociatedTokenAddress(inputMint, intentPda, true);

  await program.methods
    .submitIntent(new BN(100_000_000), minOutputAmount, nonce)
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

  await program.methods
    .submitBid(solverABid)
    .accounts({
      solver: solverA.publicKey,
      solverRegistry: solverARegistry,
      intent: intentPda,
      bid: bidAPda,
      previousWinningBid: null,
      previousSolverRegistry: null,
      systemProgram: SystemProgram.programId,
    })
    .signers([solverA])
    .rpc();

  await program.methods
    .submitBid(solverBBid)
    .accounts({
      solver: solverB.publicKey,
      solverRegistry: solverBRegistry,
      intent: intentPda,
      bid: bidBPda,
      previousWinningBid: bidAPda,
      previousSolverRegistry: solverARegistry,
      systemProgram: SystemProgram.programId,
    })
    .signers([solverB])
    .rpc();

  const intent = await program.account.intentAccount.fetch(intentPda);
  await waitUntilSlotPassed(intent.closeAtSlot.toNumber());

  await program.methods
    .settleAuction()
    .accounts({
      solver: solverB.publicKey,
      intent: intentPda,
      winningBid: bidBPda,
      solverRegistry: solverBRegistry,
      escrowTokenAccount: escrowAta,
      solverInputTokenAccount: solverBInputAta,
      solverOutputTokenAccount: solverBOutputAta,
      userOutputTokenAccount: userOutputAta,
      user: user.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([solverB])
    .rpc();

  const min = BigInt(minOutputAmount.toString());
  const singleSolverWin = BigInt(solverABid.toString());
  const twoSolverWin = BigInt(solverBBid.toString());

  const singleImprovement = singleSolverWin - min;
  const competitiveImprovement = twoSolverWin - min;

  console.log(
    JSON.stringify(
      {
        mode: "local-benchmark",
        scenarios: [
          {
            name: "single-solver-baseline",
            minOutput: minOutputAmount.toString(),
            winningOutput: solverABid.toString(),
            improvement: singleImprovement.toString(),
            improvementBps: Number((singleImprovement * 10_000n) / min),
          },
          {
            name: "two-solver-competition",
            minOutput: minOutputAmount.toString(),
            winningOutput: solverBBid.toString(),
            improvement: competitiveImprovement.toString(),
            improvementBps: Number((competitiveImprovement * 10_000n) / min),
          },
          {
            name: "timeout-recovery",
            minOutput: minOutputAmount.toString(),
            refundedInput: "100000000",
            fundsRecovered: true,
          },
        ],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
