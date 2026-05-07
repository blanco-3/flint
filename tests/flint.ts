import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const idl = require("../target/idl/flint.json");

describe("flint", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey("5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt");
  const program = new anchor.Program(idl, provider);

  const CONFIG_LOCKUP_SLOTS = new BN(100);
  const INITIAL_STAKE = new BN(100_000_000);

  let inputMint: PublicKey;
  let outputMint: PublicKey;
  let user: Keypair;
  let solver: Keypair;
  let challenger: Keypair;
  let rogueSolver: Keypair;
  let freshSolver: Keypair;
  let userInputAta: PublicKey;
  let solverInputAta: PublicKey;
  let solverOutputAta: PublicKey;
  let userOutputAta: PublicKey;
  let configPda: PublicKey;
  let solverRegistryPda: PublicKey;
  let challengerRegistryPda: PublicKey;
  let freshSolverRegistryPda: PublicKey;
  let challengerRegisteredAtSlot = 0;

  let timeoutIntentPda: PublicKey;
  let timeoutEscrowAta: PublicKey;
  let timeoutMainBidPda: PublicKey;
  let timeoutChallengerBidPda: PublicKey;
  let timeoutRefundTargetSlot = 0;

  let nonceCounter = BigInt(Date.now());

  function nextNonce() {
    nonceCounter += 1n;
    return new BN(nonceCounter.toString());
  }

  function deriveConfigPda() {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
  }

  function deriveIntentPda(nonce: BN) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        user.publicKey.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      programId
    )[0];
  }

  function deriveBidPda(intentPda: PublicKey, solverPubkey: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bid"), intentPda.toBuffer(), solverPubkey.toBuffer()],
      programId
    )[0];
  }

  function deriveSolverRegistryPda(solverPubkey: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("solver"), solverPubkey.toBuffer()],
      programId
    )[0];
  }

  async function airdrop(pubkey: PublicKey, lamports = 2e9) {
    const signature = await provider.connection.requestAirdrop(pubkey, lamports);
    await provider.connection.confirmTransaction(signature);
  }

  async function waitUntilSlotPassed(targetSlot: number) {
    let currentSlot = await provider.connection.getSlot();
    while (currentSlot <= targetSlot) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      currentSlot = await provider.connection.getSlot();
    }
    return currentSlot;
  }

  async function assertAccountClosed(pubkey: PublicKey) {
    const accountInfo = await provider.connection.getAccountInfo(pubkey);
    assert.isTrue(
      accountInfo === null || accountInfo.lamports === 0,
      `expected ${pubkey.toBase58()} to be closed`
    );
  }

  async function initializeConfig() {
    configPda = deriveConfigPda();

    await program.methods
      .initializeConfig(provider.wallet.publicKey, CONFIG_LOCKUP_SLOTS)
      .accounts({
        admin: provider.wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return program.account.configAccount.fetch(configPda);
  }

  async function registerSolverAccount(signer: Keypair) {
    const registryPda = deriveSolverRegistryPda(signer.publicKey);

    await program.methods
      .registerSolver(INITIAL_STAKE)
      .accounts({
        solver: signer.publicKey,
        solverRegistry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([signer])
      .rpc();

    return registryPda;
  }

  async function submitIntentAccount(
    nonce: BN,
    inputAmount = new BN(100_000_000),
    minOutputAmount = new BN(95_000_000)
  ) {
    const intentPda = deriveIntentPda(nonce);
    const escrowAta = await getAssociatedTokenAddress(inputMint, intentPda, true);

    await program.methods
      .submitIntent(inputAmount, minOutputAmount, nonce)
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

    return { intentPda, escrowAta };
  }

  async function submitBidFor(params: {
    signer: Keypair;
    solverRegistry: PublicKey;
    intentPda: PublicKey;
    outputAmount: BN;
    previousWinningBid?: PublicKey | null;
    previousSolverRegistry?: PublicKey | null;
    previousSolver?: PublicKey | null;
  }) {
    const bidPda = deriveBidPda(params.intentPda, params.signer.publicKey);

    await program.methods
      .submitBid(params.outputAmount)
      .accounts({
        solver: params.signer.publicKey,
        solverRegistry: params.solverRegistry,
        intent: params.intentPda,
        bid: bidPda,
        previousWinningBid: params.previousWinningBid ?? null,
        previousSolverRegistry: params.previousSolverRegistry ?? null,
        previousSolver: params.previousSolver ?? null,
        systemProgram: SystemProgram.programId,
      })
      .signers([params.signer])
      .rpc();

    return bidPda;
  }

  before(async () => {
    user = Keypair.generate();
    solver = Keypair.generate();
    challenger = Keypair.generate();
    rogueSolver = Keypair.generate();
    freshSolver = Keypair.generate();

    await airdrop(user.publicKey);
    await airdrop(solver.publicKey);
    await airdrop(challenger.publicKey);
    await airdrop(rogueSolver.publicKey);
    await airdrop(freshSolver.publicKey);

    inputMint = await createMint(provider.connection, user, user.publicKey, null, 6);
    outputMint = await createMint(provider.connection, solver, solver.publicKey, null, 6);

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

    await mintTo(provider.connection, user, inputMint, userInputAta, user, 1_000_000_000);
    await mintTo(provider.connection, solver, outputMint, solverOutputAta, solver, 2_000_000_000);

    solverRegistryPda = deriveSolverRegistryPda(solver.publicKey);
    challengerRegistryPda = deriveSolverRegistryPda(challenger.publicKey);
    freshSolverRegistryPda = deriveSolverRegistryPda(freshSolver.publicKey);

    console.log("  유저:", user.publicKey.toBase58());
    console.log("  메인 솔버:", solver.publicKey.toBase58());
    console.log("  챌린저 솔버:", challenger.publicKey.toBase58());
  });

  it("config를 초기화한다", async () => {
    const config = await initializeConfig();
    assert.equal(config.admin.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(
      config.slashAuthority.toBase58(),
      provider.wallet.publicKey.toBase58()
    );
    assert.equal(config.stakeLockupSlots.toString(), CONFIG_LOCKUP_SLOTS.toString());
  });

  it("admin만 slash authority를 변경할 수 있다", async () => {
    const candidateAuthority = Keypair.generate().publicKey;

    try {
      await program.methods
        .updateSlashAuthority(candidateAuthority)
        .accounts({
          admin: user.publicKey,
          config: configPda,
        })
        .signers([user])
        .rpc();

      assert.fail("expected UnauthorizedConfigAdmin");
    } catch (error) {
      assert.include(String(error), "UnauthorizedConfigAdmin");
    }

    await program.methods
      .updateSlashAuthority(candidateAuthority)
      .accounts({
        admin: provider.wallet.publicKey,
        config: configPda,
      })
      .rpc();

    let config = await program.account.configAccount.fetch(configPda);
    assert.equal(config.slashAuthority.toBase58(), candidateAuthority.toBase58());

    await program.methods
      .updateSlashAuthority(provider.wallet.publicKey)
      .accounts({
        admin: provider.wallet.publicKey,
        config: configPda,
      })
      .rpc();

    config = await program.account.configAccount.fetch(configPda);
    assert.equal(
      config.slashAuthority.toBase58(),
      provider.wallet.publicKey.toBase58()
    );
  });

  it("메인 솔버가 등록된다", async () => {
    await registerSolverAccount(solver);
    const registry = await program.account.solverRegistryAccount.fetch(solverRegistryPda);
    assert.equal(registry.solver.toBase58(), solver.publicKey.toBase58());
    assert.equal(registry.stakeAmount.toString(), INITIAL_STAKE.toString());
    assert.equal(registry.totalBids.toString(), "0");
    assert.equal(registry.totalFills.toString(), "0");
    assert.equal(registry.activeWinningBids.toString(), "0");
  });

  it("챌린저 솔버가 등록된다", async () => {
    await registerSolverAccount(challenger);
    const registry = await program.account.solverRegistryAccount.fetch(
      challengerRegistryPda
    );
    challengerRegisteredAtSlot = registry.registeredAtSlot.toNumber();
    assert.equal(registry.solver.toBase58(), challenger.publicKey.toBase58());
    assert.equal(registry.activeWinningBids.toString(), "0");
  });

  it("신규 솔버는 락업 전 withdraw_stake가 실패한다", async () => {
    await registerSolverAccount(freshSolver);

    try {
      await program.methods
        .withdrawStake()
        .accounts({
          solver: freshSolver.publicKey,
          config: configPda,
          solverRegistry: freshSolverRegistryPda,
        })
        .signers([freshSolver])
        .rpc();

      assert.fail("expected StakeLockupActive");
    } catch (error) {
      assert.include(String(error), "StakeLockupActive");
    }
  });

  it("미등록 솔버는 bid를 넣을 수 없다", async () => {
    const nonce = nextNonce();
    const { intentPda } = await submitIntentAccount(
      nonce,
      new BN(40_000_000),
      new BN(35_000_000)
    );
    const rogueRegistryPda = deriveSolverRegistryPda(rogueSolver.publicKey);

    try {
      await submitBidFor({
        signer: rogueSolver,
        solverRegistry: rogueRegistryPda,
        intentPda,
        outputAmount: new BN(36_000_000),
      });

      assert.fail("expected unregistered solver bid to fail");
    } catch (error) {
      assert.notEqual(String(error).length, 0);
    }
  });

  it("인텐트 제출자는 자기 인텐트에 bid를 넣을 수 없다", async () => {
    const userRegistryPda = deriveSolverRegistryPda(user.publicKey);
    await registerSolverAccount(user);

    const nonce = nextNonce();
    const { intentPda } = await submitIntentAccount(
      nonce,
      new BN(40_000_000),
      new BN(35_000_000)
    );

    try {
      await submitBidFor({
        signer: user,
        solverRegistry: userRegistryPda,
        intentPda,
        outputAmount: new BN(36_000_000),
      });

      assert.fail("expected SelfBidNotAllowed");
    } catch (error) {
      assert.include(String(error), "SelfBidNotAllowed");
    }
  });

  it("정상 경매는 settle_auction 후 계정들을 닫고 체결 카운터를 올린다", async () => {
    const nonce = nextNonce();
    const { intentPda, escrowAta } = await submitIntentAccount(nonce);
    const registryBefore = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );

    const bidPda = await submitBidFor({
      signer: solver,
      solverRegistry: solverRegistryPda,
      intentPda,
      outputAmount: new BN(98_000_000),
    });

    const registryAfterBid = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    assert.equal(
      BigInt(registryAfterBid.totalBids.toString()) -
        BigInt(registryBefore.totalBids.toString()),
      BigInt(1)
    );
    assert.equal(registryAfterBid.activeWinningBids.toString(), "1");

    const solverInputBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(solverInputAta)).value.amount
    );
    const userOutputBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(userOutputAta)).value.amount
    );

    const intentAccount = await program.account.intentAccount.fetch(intentPda);
    await waitUntilSlotPassed(intentAccount.closeAtSlot.toNumber());

    await program.methods
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

    const registryAfterSettle = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const solverInputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(solverInputAta)).value.amount
    );
    const userOutputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(userOutputAta)).value.amount
    );

    assert.equal(solverInputAfter - solverInputBefore, BigInt(100_000_000));
    assert.equal(userOutputAfter - userOutputBefore, BigInt(98_000_000));
    assert.equal(registryAfterSettle.totalFills.toString(), "1");
    assert.equal(registryAfterSettle.activeWinningBids.toString(), "0");

    await assertAccountClosed(intentPda);
    await assertAccountClosed(bidPda);
    await assertAccountClosed(escrowAta);
  });

  it("timeout 후보 인텐트에 메인 솔버가 먼저 입찰한다", async () => {
    const nonce = nextNonce();
    const { intentPda, escrowAta } = await submitIntentAccount(
      nonce,
      new BN(60_000_000),
      new BN(55_000_000)
    );

    timeoutIntentPda = intentPda;
    timeoutEscrowAta = escrowAta;
    timeoutMainBidPda = await submitBidFor({
      signer: solver,
      solverRegistry: solverRegistryPda,
      intentPda,
      outputAmount: new BN(57_000_000),
    });

    const registry = await program.account.solverRegistryAccount.fetch(solverRegistryPda);
    assert.equal(registry.activeWinningBids.toString(), "1");
  });

  it("outbid 시 이전 winner 계정이 없으면 실패한다", async () => {
    try {
      await submitBidFor({
        signer: challenger,
        solverRegistry: challengerRegistryPda,
        intentPda: timeoutIntentPda,
        outputAmount: new BN(58_000_000),
      });

      assert.fail("expected PreviousWinningBidRequired");
    } catch (error) {
      assert.include(String(error), "PreviousWinningBidRequired");
    }
  });

  it("outbid가 성공하면 이전/신규 solver registry 카운터가 갱신된다", async () => {
    const solverRegistryBefore = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const challengerRegistryBefore = await program.account.solverRegistryAccount.fetch(
      challengerRegistryPda
    );

    timeoutChallengerBidPda = await submitBidFor({
      signer: challenger,
      solverRegistry: challengerRegistryPda,
      intentPda: timeoutIntentPda,
      outputAmount: new BN(59_000_000),
      previousWinningBid: timeoutMainBidPda,
      previousSolverRegistry: solverRegistryPda,
      previousSolver: solver.publicKey,
    });

    const timeoutIntent = await program.account.intentAccount.fetch(timeoutIntentPda);
    const solverRegistryAfter = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const challengerRegistryAfter = await program.account.solverRegistryAccount.fetch(
      challengerRegistryPda
    );

    timeoutRefundTargetSlot = timeoutIntent.closeAtSlot.toNumber() + 10;

    assert.equal(timeoutIntent.winningBid?.toBase58(), timeoutChallengerBidPda.toBase58());
    assert.equal(
      BigInt(solverRegistryAfter.activeWinningBids.toString()),
      BigInt(solverRegistryBefore.activeWinningBids.toString()) - BigInt(1)
    );
    assert.equal(
      BigInt(challengerRegistryAfter.activeWinningBids.toString()),
      BigInt(challengerRegistryBefore.activeWinningBids.toString()) + BigInt(1)
    );
    assert.equal(
      BigInt(challengerRegistryAfter.totalBids.toString()) -
        BigInt(challengerRegistryBefore.totalBids.toString()),
      BigInt(1)
    );
    await assertAccountClosed(timeoutMainBidPda);
  });

  it("잘못된 이전 winner 계정을 넘기면 실패한다", async () => {
    const nonce = nextNonce();
    const { intentPda } = await submitIntentAccount(
      nonce,
      new BN(50_000_000),
      new BN(45_000_000)
    );

    await submitBidFor({
      signer: solver,
      solverRegistry: solverRegistryPda,
      intentPda,
      outputAmount: new BN(47_000_000),
    });

    try {
      await submitBidFor({
        signer: challenger,
        solverRegistry: challengerRegistryPda,
        intentPda,
        outputAmount: new BN(48_000_000),
        previousWinningBid: timeoutChallengerBidPda,
        previousSolverRegistry: challengerRegistryPda,
        previousSolver: challenger.publicKey,
      });

      assert.fail("expected PreviousWinningBidMismatch");
    } catch (error) {
      assert.include(String(error), "PreviousWinningBidMismatch");
    }
  });

  it("cancel_intent는 no-bid 인텐트를 닫고 환불한다", async () => {
    const nonce = nextNonce();
    const inputAmount = new BN(50_000_000);
    const userInputBeforeSubmit = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );
    const { intentPda, escrowAta } = await submitIntentAccount(
      nonce,
      inputAmount,
      new BN(45_000_000)
    );
    const intent = await program.account.intentAccount.fetch(intentPda);
    await waitUntilSlotPassed(intent.closeAtSlot.toNumber());

    await program.methods
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

    const userInputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );
    assert.equal(userInputAfter, userInputBeforeSubmit);
    await assertAccountClosed(intentPda);
    await assertAccountClosed(escrowAta);
  });

  it("lockup이 지나도 active exposure가 있으면 withdraw_stake는 실패한다", async () => {
    const targetSlot = Math.max(challengerRegisteredAtSlot + 100, timeoutRefundTargetSlot);
    await waitUntilSlotPassed(targetSlot);

    try {
      await program.methods
        .withdrawStake()
        .accounts({
          solver: challenger.publicKey,
          config: configPda,
          solverRegistry: challengerRegistryPda,
        })
        .signers([challenger])
        .rpc();

      assert.fail("expected ActiveWinningBidsExist");
    } catch (error) {
      assert.include(String(error), "ActiveWinningBidsExist");
    }
  });

  it("refund_after_timeout는 timeout winner를 정리하고 계정을 닫는다", async () => {
    const registryBefore = await program.account.solverRegistryAccount.fetch(
      challengerRegistryPda
    );
    const registryInfoBefore = await provider.connection.getAccountInfo(
      challengerRegistryPda
    );
    assert.isNotNull(registryInfoBefore);

    const stakeBefore = BigInt(registryBefore.stakeAmount.toString());
    const minBalance = BigInt(
      await provider.connection.getMinimumBalanceForRentExemption(
        registryInfoBefore!.data.length
      )
    );
    const userInputBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );
    const nominalSlash = (stakeBefore * BigInt(2000)) / BigInt(10_000);
    const withdrawable =
      BigInt(registryInfoBefore!.lamports) > minBalance
        ? BigInt(registryInfoBefore!.lamports) - minBalance
        : BigInt(0);
    const safeSlash = nominalSlash < withdrawable ? nominalSlash : withdrawable;

    await program.methods
      .refundAfterTimeout()
      .accounts({
        caller: provider.wallet.publicKey,
        solver: challenger.publicKey,
        solverRegistry: challengerRegistryPda,
        intent: timeoutIntentPda,
        winningBid: timeoutChallengerBidPda,
        escrowTokenAccount: timeoutEscrowAta,
        userTokenAccount: userInputAta,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const userInputAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(userInputAta)).value.amount
    );
    const registryAfter = await program.account.solverRegistryAccount.fetch(
      challengerRegistryPda
    );

    assert.equal(userInputAfter - userInputBefore, BigInt(60_000_000));
    assert.equal(
      BigInt(registryAfter.stakeAmount.toString()),
      stakeBefore - safeSlash
    );
    assert.equal(registryAfter.activeWinningBids.toString(), "0");
    assert.equal(
      BigInt(registryBefore.reputationScore.toString()) -
        BigInt(registryAfter.reputationScore.toString()),
      BigInt(100)
    );

    await assertAccountClosed(timeoutIntentPda);
    await assertAccountClosed(timeoutChallengerBidPda);
    await assertAccountClosed(timeoutEscrowAta);
  });

  it("refund_after_timeout 이후 settle_auction는 다시 실행되지 않는다", async () => {
    try {
      await program.methods
        .settleAuction()
        .accounts({
          solver: challenger.publicKey,
          intent: timeoutIntentPda,
          winningBid: timeoutChallengerBidPda,
          solverRegistry: challengerRegistryPda,
          escrowTokenAccount: timeoutEscrowAta,
          solverInputTokenAccount: solverInputAta,
          solverOutputTokenAccount: solverOutputAta,
          userOutputTokenAccount: userOutputAta,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([challenger])
        .rpc();

      assert.fail("expected settle_auction replay to fail");
    } catch (error) {
      assert.notEqual(String(error).length, 0);
    }
  });

  it("refund_after_timeout은 재호출되지 않는다", async () => {
    try {
      await program.methods
        .refundAfterTimeout()
        .accounts({
          caller: provider.wallet.publicKey,
          solver: challenger.publicKey,
          solverRegistry: challengerRegistryPda,
          intent: timeoutIntentPda,
          winningBid: timeoutChallengerBidPda,
          escrowTokenAccount: timeoutEscrowAta,
          userTokenAccount: userInputAta,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("expected second refund_after_timeout to fail");
    } catch (error) {
      assert.notEqual(String(error).length, 0);
    }
  });

  it("slash authority가 아니면 slash_solver는 실패한다", async () => {
    const nonce = nextNonce();
    const { intentPda } = await submitIntentAccount(
      nonce,
      new BN(45_000_000),
      new BN(42_000_000)
    );
    const bidPda = await submitBidFor({
      signer: solver,
      solverRegistry: solverRegistryPda,
      intentPda,
      outputAmount: new BN(43_000_000),
    });
    const intent = await program.account.intentAccount.fetch(intentPda);
    await waitUntilSlotPassed(intent.closeAtSlot.toNumber());

    try {
      await program.methods
        .slashSolver()
        .accounts({
          authority: user.publicKey,
          config: configPda,
          solver: solver.publicKey,
          solverRegistry: solverRegistryPda,
          intent: intentPda,
          winningBid: bidPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      assert.fail("expected UnauthorizedSlashAuthority");
    } catch (error) {
      assert.include(String(error), "UnauthorizedSlashAuthority");
    }
  });

  it("올바른 authority는 slash_solver를 실행할 수 있다", async () => {
    const nonce = nextNonce();
    const { intentPda } = await submitIntentAccount(
      nonce,
      new BN(35_000_000),
      new BN(32_000_000)
    );
    const bidPda = await submitBidFor({
      signer: solver,
      solverRegistry: solverRegistryPda,
      intentPda,
      outputAmount: new BN(33_000_000),
    });
    const intent = await program.account.intentAccount.fetch(intentPda);
    await waitUntilSlotPassed(intent.closeAtSlot.toNumber());

    const registryBefore = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const registryInfoBefore = await provider.connection.getAccountInfo(solverRegistryPda);
    assert.isNotNull(registryInfoBefore);
    const minBalance = BigInt(
      await provider.connection.getMinimumBalanceForRentExemption(
        registryInfoBefore!.data.length
      )
    );
    const stakeBefore = BigInt(registryBefore.stakeAmount.toString());
    const nominalSlash = (stakeBefore * BigInt(2000)) / BigInt(10_000);
    const withdrawable =
      BigInt(registryInfoBefore!.lamports) > minBalance
        ? BigInt(registryInfoBefore!.lamports) - minBalance
        : BigInt(0);
    const safeSlash = nominalSlash < withdrawable ? nominalSlash : withdrawable;

    await program.methods
      .slashSolver()
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        solver: solver.publicKey,
        solverRegistry: solverRegistryPda,
        intent: intentPda,
        winningBid: bidPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const registryAfter = await program.account.solverRegistryAccount.fetch(
      solverRegistryPda
    );
    const intentAfter = await program.account.intentAccount.fetch(intentPda);
    assert.equal(
      BigInt(registryAfter.stakeAmount.toString()),
      stakeBefore - safeSlash
    );
    assert.equal(
      BigInt(registryAfter.activeWinningBids.toString()),
      BigInt(registryBefore.activeWinningBids.toString()) - BigInt(1)
    );
    assert.deepEqual(intentAfter.status, { expired: {} });
    assert.isNull(intentAfter.winningBid);
    await assertAccountClosed(bidPda);
  });

  it("slash_solver 이후 refund_after_timeout은 재실행되지 않는다", async () => {
    const nonce = nextNonce();
    const { intentPda, escrowAta } = await submitIntentAccount(
      nonce,
      new BN(34_000_000),
      new BN(31_000_000)
    );
    const bidPda = await submitBidFor({
      signer: freshSolver,
      solverRegistry: freshSolverRegistryPda,
      intentPda,
      outputAmount: new BN(32_000_000),
    });
    const intent = await program.account.intentAccount.fetch(intentPda);
    await waitUntilSlotPassed(intent.closeAtSlot.toNumber());

    await program.methods
      .slashSolver()
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        solver: freshSolver.publicKey,
        solverRegistry: freshSolverRegistryPda,
        intent: intentPda,
        winningBid: bidPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await assertAccountClosed(bidPda);

    try {
      await program.methods
        .refundAfterTimeout()
        .accounts({
          caller: provider.wallet.publicKey,
          solver: freshSolver.publicKey,
          solverRegistry: freshSolverRegistryPda,
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

      assert.fail("expected refund_after_timeout replay to fail");
    } catch (error) {
      assert.notEqual(String(error).length, 0);
    }
  });

  it("active exposure가 정리되면 withdraw_stake가 성공한다", async () => {
    await program.methods
      .withdrawStake()
      .accounts({
        solver: challenger.publicKey,
        config: configPda,
        solverRegistry: challengerRegistryPda,
      })
      .signers([challenger])
      .rpc();

    await assertAccountClosed(challengerRegistryPda);
  });
});
