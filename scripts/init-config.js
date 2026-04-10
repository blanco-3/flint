#!/usr/bin/env node

const anchor = require("@coral-xyz/anchor");
const BN = require("bn.js");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const { createRequire } = require("module");

const requireFromModule = createRequire(__filename);
const idl = requireFromModule("../target/idl/flint.json");

const PROGRAM_ID = new PublicKey("5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt");

function deriveConfigPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);

  const configPda = deriveConfigPda();
  const existing = await program.account.configAccount.fetchNullable(configPda);

  if (existing) {
    console.log(
      JSON.stringify(
        {
          action: "already_initialized",
          configPda: configPda.toBase58(),
          admin: existing.admin.toBase58(),
          slashAuthority: existing.slashAuthority.toBase58(),
          stakeLockupSlots: existing.stakeLockupSlots.toString(),
        },
        null,
        2
      )
    );
    return;
  }

  const slashAuthority = provider.wallet.publicKey;
  const signature = await program.methods
    .initializeConfig(slashAuthority, new BN(100))
    .accounts({
      admin: provider.wallet.publicKey,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(
    JSON.stringify(
      {
        action: "initialized",
        configPda: configPda.toBase58(),
        signature,
        slashAuthority: slashAuthority.toBase58(),
        stakeLockupSlots: "100",
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
