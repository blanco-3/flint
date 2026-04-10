import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";

// IDL 타입은 자동생성 없이 수동 로드
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const idl = require("../target/idl/flint.json");

describe("flint", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Program ID는 Anchor.toml의 localnet 값
  const programId = new PublicKey("5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt");
  const program = new anchor.Program(idl, provider);

  let inputMint: PublicKey;
  let outputMint: PublicKey;
  let user: Keypair;
  let solver: Keypair;
  let userInputAta: PublicKey;
  let solverInputAta: PublicKey;
  let solverOutputAta: PublicKey;
  let userOutputAta: PublicKey;

  const NONCE = new BN(Date.now());

  before(async () => {
    user = Keypair.generate();
    solver = Keypair.generate();

    // SOL 에어드랍
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 2e9)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(solver.publicKey, 2e9)
    );

    // 두 가지 SPL 토큰 민트 생성
    inputMint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      6
    );
    outputMint = await createMint(
      provider.connection,
      solver,
      solver.publicKey,
      null,
      6
    );

    // ATA 생성
    userInputAta = await createAssociatedTokenAccount(
      provider.connection,
      user,
      inputMint,
      user.publicKey
    );
    solverInputAta = await createAssociatedTokenAccount(
      provider.connection,
      solver,
      inputMint,
      solver.publicKey
    );
    solverOutputAta = await createAssociatedTokenAccount(
      provider.connection,
      solver,
      outputMint,
      solver.publicKey
    );
    userOutputAta = await createAssociatedTokenAccount(
      provider.connection,
      user,
      outputMint,
      user.publicKey
    );

    // 유저에게 1000 input 토큰 민트
    await mintTo(
      provider.connection,
      user,
      inputMint,
      userInputAta,
      user,
      1_000_000_000 // 1000 with 6 decimals
    );

    // 솔버에게 2000 output 토큰 민트 (체결 여유분)
    await mintTo(
      provider.connection,
      solver,
      outputMint,
      solverOutputAta,
      solver,
      2_000_000_000
    );

    console.log("  유저:", user.publicKey.toBase58());
    console.log("  솔버:", solver.publicKey.toBase58());
    console.log("  inputMint:", inputMint.toBase58());
    console.log("  outputMint:", outputMint.toBase58());
  });

  it("유저가 인텐트를 제출한다", async () => {
    const [intentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        NONCE.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );

    const escrowAta = await getAssociatedTokenAddress(
      inputMint,
      intentPda,
      true // allowOwnerOffCurve: PDA는 curve 밖에 있음
    );

    const inputAmount = new BN(100_000_000); // 100 tokens
    const minOutputAmount = new BN(95_000_000); // 95 tokens 최소 요구

    const tx = await program.methods
      .submitIntent(inputAmount, minOutputAmount, NONCE)
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

    console.log("  submit_intent tx:", tx);

    // Intent 계정 검증
    const intentAccount = await program.account.intentAccount.fetch(intentPda);
    assert.equal(intentAccount.user.toBase58(), user.publicKey.toBase58());
    assert.equal(intentAccount.inputAmount.toString(), inputAmount.toString());
    assert.equal(intentAccount.minOutputAmount.toString(), minOutputAmount.toString());
    assert.deepEqual(intentAccount.status, { open: {} });
    assert.isNull(intentAccount.winningBid);

    console.log("  인텐트 상태:", intentAccount.status);
    console.log("  경매 창: 슬롯", intentAccount.openAtSlot.toString(), "~", intentAccount.closeAtSlot.toString());
  });

  it("솔버가 인텐트에 입찰한다", async () => {
    const [intentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        NONCE.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );

    const [bidPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bid"),
        intentPda.toBuffer(),
        solver.publicKey.toBuffer(),
      ],
      programId
    );

    const outputAmount = new BN(98_000_000); // 98 tokens 제시

    const tx = await program.methods
      .submitBid(outputAmount)
      .accounts({
        solver: solver.publicKey,
        intent: intentPda,
        bid: bidPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();

    console.log("  submit_bid tx:", tx);

    // Intent 최고가 갱신 확인
    const intentAccount = await program.account.intentAccount.fetch(intentPda);
    assert.equal(intentAccount.bestBidAmount.toString(), outputAmount.toString());
    assert.equal(intentAccount.winningBid?.toBase58(), bidPda.toBase58());

    // Bid 계정 확인
    const bidAccount = await program.account.bidAccount.fetch(bidPda);
    assert.equal(bidAccount.solver.toBase58(), solver.publicKey.toBase58());
    assert.equal(bidAccount.outputAmount.toString(), outputAmount.toString());
    assert.isFalse(bidAccount.isSettled);

    console.log("  최고 입찰가:", intentAccount.bestBidAmount.toString());
  });
});
