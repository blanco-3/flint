import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  createMint,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
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
  let refundedIntentPda: PublicKey;
  let refundedBidPda: PublicKey;
  let refundedEscrowAta: PublicKey;

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

  async function waitUntilSlotPassed(targetSlot: number) {
    let currentSlot = await provider.connection.getSlot();
    while (currentSlot <= targetSlot) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      currentSlot = await provider.connection.getSlot();
    }
    return currentSlot;
  }

  async function ensureIntentEscrowAta(intentPda: PublicKey) {
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      inputMint,
      intentPda,
      true
    );
  }

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

  it("경매 종료 후 정산한다 (settle_auction)", async () => {
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

    const escrowAta = await getAssociatedTokenAddress(
      inputMint,
      intentPda,
      true
    );

    // 경매 창 종료 대기 (AUCTION_WINDOW_SLOTS=5, 약 2초)
    const intentAccount = await program.account.intentAccount.fetch(intentPda);
    const closeAtSlot = intentAccount.closeAtSlot.toNumber();
    let currentSlot = await provider.connection.getSlot();
    while (currentSlot <= closeAtSlot) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      currentSlot = await provider.connection.getSlot();
    }
    console.log("  경매 종료. 현재 슬롯:", currentSlot, "종료 슬롯:", closeAtSlot);

    // 정산 전 잔액
    const solverInputBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(solverInputAta)).value.amount
    );
    const userOutputBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(userOutputAta)).value.amount
    );

    const tx = await program.methods
      .settleAuction()
      .accounts({
        solver: solver.publicKey,
        intent: intentPda,
        winningBid: bidPda,
        escrowTokenAccount: escrowAta,
        solverInputTokenAccount: solverInputAta,
        solverOutputTokenAccount: solverOutputAta,
        userOutputTokenAccount: userOutputAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();

    console.log("  settle_auction tx:", tx);

    // 상태 검증
    const intentAfter = await program.account.intentAccount.fetch(intentPda);
    assert.deepEqual(intentAfter.status, { filled: {} });

    const bidAfter = await program.account.bidAccount.fetch(bidPda);
    assert.isTrue(bidAfter.isSettled);

    // 토큰 잔액 검증
    const solverInputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(solverInputAta)).value.amount
    );
    const userOutputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(userOutputAta)).value.amount
    );

    // 솔버: input 100개 수령, 유저: output 98개 수령
    assert.equal(solverInputAfter - solverInputBefore, BigInt(100_000_000));
    assert.equal(userOutputAfter - userOutputBefore, BigInt(98_000_000));

    console.log("  솔버 input 수령:", (solverInputAfter - solverInputBefore).toString());
    console.log("  유저 output 수령:", (userOutputAfter - userOutputBefore).toString());
  });

  it("솔버가 레지스트리에 등록한다", async () => {
    const [solverRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("solver"), solver.publicKey.toBuffer()],
      programId
    );

    const tx = await program.methods
      .registerSolver(new BN(100_000_000))
      .accounts({
        solver: solver.publicKey,
        solverRegistry: solverRegistryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();

    console.log("  register_solver tx:", tx);

    const registryAccount = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    assert.equal(registryAccount.solver.toBase58(), solver.publicKey.toBase58());
    assert.equal(registryAccount.stakeAmount.toString(), "100000000");
    assert.equal(registryAccount.reputationScore.toString(), "1000");
  });

  it("유저가 인텐트를 취소하고 환불받는다", async () => {
    const cancelNonce = new BN(Date.now() + 1);
    const [intentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        cancelNonce.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );

    const escrowAta = await getAssociatedTokenAddress(inputMint, intentPda, true);
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(45_000_000);
    const userInputBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );

    await program.methods
      .submitIntent(inputAmount, minOutputAmount, cancelNonce)
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

    const intentBeforeCancel = await program.account.intentAccount.fetch(intentPda);
    const closeAtSlot = intentBeforeCancel.closeAtSlot.toNumber();
    await waitUntilSlotPassed(closeAtSlot);

    const tx = await program.methods
      .cancelIntent()
      .accounts({
        user: user.publicKey,
        intent: intentPda,
        escrowTokenAccount: escrowAta,
        userTokenAccount: userInputAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log("  cancel_intent tx:", tx);

    const intentAfterCancel = await program.account.intentAccount.fetch(intentPda);
    assert.deepEqual(intentAfterCancel.status, { cancelled: {} });

    const userInputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );
    assert.equal(userInputAfter, userInputBefore);
  });

  it("미정산 낙찰이 grace 이후 환불되고 슬래시된다", async () => {
    const refundNonce = new BN(Date.now() + 10);
    refundedIntentPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        refundNonce.toArrayLike(Buffer, "le", 8),
      ],
      programId
    )[0];
    refundedBidPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bid"),
        refundedIntentPda.toBuffer(),
        solver.publicKey.toBuffer(),
      ],
      programId
    )[0];
    refundedEscrowAta = await getAssociatedTokenAddress(
      inputMint,
      refundedIntentPda,
      true
    );

    const [solverRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("solver"), solver.publicKey.toBuffer()],
      programId
    );
    const inputAmount = new BN(60_000_000);
    const minOutputAmount = new BN(55_000_000);
    const userInputBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );

    await program.methods
      .submitIntent(inputAmount, minOutputAmount, refundNonce)
      .accounts({
        user: user.publicKey,
        inputMint,
        outputMint,
        userTokenAccount: userInputAta,
        escrowTokenAccount: refundedEscrowAta,
        intent: refundedIntentPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    await program.methods
      .submitBid(new BN(57_000_000))
      .accounts({
        solver: solver.publicKey,
        intent: refundedIntentPda,
        bid: refundedBidPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();

    const refundIntent = await program.account.intentAccount.fetch(refundedIntentPda);
    const refundTargetSlot = refundIntent.closeAtSlot.toNumber() + 10;
    await waitUntilSlotPassed(refundTargetSlot);

    const registryBefore = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const registryInfoBefore = await provider.connection.getAccountInfo(
      solverRegistryPda
    );
    assert.isNotNull(registryInfoBefore);

    const stakeBefore = BigInt(registryBefore.stakeAmount.toString());
    const minBalance = BigInt(
      await provider.connection.getMinimumBalanceForRentExemption(
        registryInfoBefore!.data.length
      )
    );
    const lamportsBefore = BigInt(registryInfoBefore!.lamports);
    const nominalSlash = (stakeBefore * BigInt(2000)) / BigInt(10_000);
    const withdrawableLamports =
      lamportsBefore > minBalance ? lamportsBefore - minBalance : BigInt(0);
    const safeSlash =
      nominalSlash < withdrawableLamports ? nominalSlash : withdrawableLamports;

    const tx = await program.methods
      .refundAfterTimeout()
      .accounts({
        caller: provider.wallet.publicKey,
        solver: solver.publicKey,
        solverRegistry: solverRegistryPda,
        intent: refundedIntentPda,
        winningBid: refundedBidPda,
        escrowTokenAccount: refundedEscrowAta,
        userTokenAccount: userInputAta,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  refund_after_timeout tx:", tx);

    const intentAfter = await program.account.intentAccount.fetch(refundedIntentPda);
    const bidAfter = await program.account.bidAccount.fetch(refundedBidPda);
    const registryAfter = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const userInputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );
    const escrowInfoAfter = await provider.connection.getAccountInfo(refundedEscrowAta);

    assert.deepEqual(intentAfter.status, { expired: {} });
    assert.isTrue(bidAfter.isSettled);
    assert.equal(userInputAfter, userInputBefore);
    assert.isNull(escrowInfoAfter, "escrow ATA should be closed");
    assert.equal(
      BigInt(registryAfter.stakeAmount.toString()),
      stakeBefore - safeSlash,
      "safe_slash만큼 stake가 감소해야 함"
    );
    assert.equal(
      BigInt(registryBefore.reputationScore.toString()) -
        BigInt(registryAfter.reputationScore.toString()),
      BigInt(100)
    );
  });

  it("grace 이전에는 refund_after_timeout이 실패한다", async () => {
    const graceNonce = new BN(Date.now() + 20);
    const [graceIntentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        graceNonce.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );
    const [graceBidPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bid"),
        graceIntentPda.toBuffer(),
        solver.publicKey.toBuffer(),
      ],
      programId
    );
    const graceEscrowAta = await getAssociatedTokenAddress(
      inputMint,
      graceIntentPda,
      true
    );
    const [solverRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("solver"), solver.publicKey.toBuffer()],
      programId
    );

    await program.methods
      .submitIntent(new BN(40_000_000), new BN(35_000_000), graceNonce)
      .accounts({
        user: user.publicKey,
        inputMint,
        outputMint,
        userTokenAccount: userInputAta,
        escrowTokenAccount: graceEscrowAta,
        intent: graceIntentPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    await program.methods
      .submitBid(new BN(38_000_000))
      .accounts({
        solver: solver.publicKey,
        intent: graceIntentPda,
        bid: graceBidPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();

    const graceIntent = await program.account.intentAccount.fetch(graceIntentPda);
    await waitUntilSlotPassed(graceIntent.closeAtSlot.toNumber());

    try {
      await program.methods
        .refundAfterTimeout()
        .accounts({
          caller: provider.wallet.publicKey,
          solver: solver.publicKey,
          solverRegistry: solverRegistryPda,
          intent: graceIntentPda,
          winningBid: graceBidPda,
          escrowTokenAccount: graceEscrowAta,
          userTokenAccount: userInputAta,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("expected RefundGracePeriodNotElapsed");
    } catch (error) {
      assert.include(String(error), "RefundGracePeriodNotElapsed");
    }
  });

  it("winning bid가 없으면 refund_after_timeout이 실패한다", async () => {
    const noBidNonce = new BN(Date.now() + 30);
    const [noBidIntentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        noBidNonce.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );
    const noBidEscrowAta = await getAssociatedTokenAddress(
      inputMint,
      noBidIntentPda,
      true
    );
    const [solverRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("solver"), solver.publicKey.toBuffer()],
      programId
    );
    const [existingBidPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bid"),
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("intent"),
            user.publicKey.toBuffer(),
            NONCE.toArrayLike(Buffer, "le", 8),
          ],
          programId
        )[0].toBuffer(),
        solver.publicKey.toBuffer(),
      ],
      programId
    );

    await program.methods
      .submitIntent(new BN(30_000_000), new BN(28_000_000), noBidNonce)
      .accounts({
        user: user.publicKey,
        inputMint,
        outputMint,
        userTokenAccount: userInputAta,
        escrowTokenAccount: noBidEscrowAta,
        intent: noBidIntentPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    const noBidIntent = await program.account.intentAccount.fetch(noBidIntentPda);
    await waitUntilSlotPassed(noBidIntent.closeAtSlot.toNumber() + 10);

    try {
      await program.methods
        .refundAfterTimeout()
        .accounts({
          caller: provider.wallet.publicKey,
          solver: solver.publicKey,
          solverRegistry: solverRegistryPda,
          intent: noBidIntentPda,
          winningBid: existingBidPda,
          escrowTokenAccount: noBidEscrowAta,
          userTokenAccount: userInputAta,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("expected NoBidsReceived");
    } catch (error) {
      assert.include(String(error), "NoBidsReceived");
    }
  });

  it("refund_after_timeout 이후 settle_auction는 실패한다", async () => {
    await ensureIntentEscrowAta(refundedIntentPda);

    try {
      await program.methods
        .settleAuction()
        .accounts({
          solver: solver.publicKey,
          intent: refundedIntentPda,
          winningBid: refundedBidPda,
          escrowTokenAccount: refundedEscrowAta,
          solverInputTokenAccount: solverInputAta,
          solverOutputTokenAccount: solverOutputAta,
          userOutputTokenAccount: userOutputAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([solver])
        .rpc();

      assert.fail("expected settle_auction to fail after refund");
    } catch (error) {
      assert.include(String(error), "IntentNotOpen");
    }
  });

  it("refund_after_timeout 성공 후 두 번째 호출도 실패한다", async () => {
    await ensureIntentEscrowAta(refundedIntentPda);

    const [solverRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("solver"), solver.publicKey.toBuffer()],
      programId
    );

    try {
      await program.methods
        .refundAfterTimeout()
        .accounts({
          caller: provider.wallet.publicKey,
          solver: solver.publicKey,
          solverRegistry: solverRegistryPda,
          intent: refundedIntentPda,
          winningBid: refundedBidPda,
          escrowTokenAccount: refundedEscrowAta,
          userTokenAccount: userInputAta,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("expected second refund_after_timeout to fail");
    } catch (error) {
      assert.include(String(error), "IntentNotOpen");
    }
  });

  it("낙찰 솔버가 슬래싱된다 (미정산 케이스)", async () => {
    const slashNonce = new BN(Date.now() + 100);
    const [slashIntentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        slashNonce.toArrayLike(Buffer, "le", 8),
      ],
      programId
    );
    const [slashBidPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("bid"),
        slashIntentPda.toBuffer(),
        solver.publicKey.toBuffer(),
      ],
      programId
    );
    const slashEscrowAta = await getAssociatedTokenAddress(
      inputMint,
      slashIntentPda,
      true
    );
    const [solverRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("solver"), solver.publicKey.toBuffer()],
      programId
    );

    await program.methods
      .submitIntent(new BN(50_000_000), new BN(45_000_000), slashNonce)
      .accounts({
        user: user.publicKey,
        inputMint,
        outputMint,
        userTokenAccount: userInputAta,
        escrowTokenAccount: slashEscrowAta,
        intent: slashIntentPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    await program.methods
      .submitBid(new BN(48_000_000))
      .accounts({
        solver: solver.publicKey,
        intent: slashIntentPda,
        bid: slashBidPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();

    const slashIntent = await program.account.intentAccount.fetch(slashIntentPda);
    const slashCloseAt = slashIntent.closeAtSlot.toNumber();
    const currentSlot = await waitUntilSlotPassed(slashCloseAt);
    console.log("  슬래시 경매 종료. 현재 슬롯:", currentSlot, "종료 슬롯:", slashCloseAt);

    const registryBefore = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const stakeBefore = registryBefore.stakeAmount.toNumber();

    const tx = await program.methods
      .slashSolver()
      .accounts({
        authority: provider.wallet.publicKey,
        solver: solver.publicKey,
        solverRegistry: solverRegistryPda,
        intent: slashIntentPda,
        winningBid: slashBidPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  slash_solver tx:", tx);

    const registryAfter = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const stakeAfter = registryAfter.stakeAmount.toNumber();
    const expectedSlash = Math.floor((stakeBefore * 2000) / 10000);
    const expectedRemaining = stakeBefore - expectedSlash;

    assert.equal(stakeAfter, expectedRemaining, "스테이크가 20% 삭감되어야 함");
    assert.equal(
      registryAfter.reputationScore.toNumber(),
      registryBefore.reputationScore.toNumber() - 100,
      "평판 점수가 100 감소해야 함"
    );
    console.log("  슬래시 전 스테이크:", stakeBefore, "후:", stakeAfter);
  });
});
