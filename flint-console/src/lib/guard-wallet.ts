import { Connection, VersionedTransaction } from "@solana/web3.js";

type InjectedWallet = {
  publicKey?: {
    toBase58(): string;
  };
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?: () => Promise<void>;
  signAndSendTransaction?: (transaction: VersionedTransaction) => Promise<{ signature: unknown }>;
  signTransaction?: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
};

declare global {
  interface Window {
    solana?: InjectedWallet;
    phantom?: { solana?: InjectedWallet };
    backpack?: { solana?: InjectedWallet };
  }
}

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

export function getInjectedWallet() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.phantom?.solana ?? window.backpack?.solana ?? window.solana ?? null;
}

export async function connectInjectedWallet() {
  const wallet = getInjectedWallet();
  if (!wallet) {
    throw new Error("No injected Solana wallet found. Use Phantom, Backpack, or another wallet that exposes window.solana.");
  }
  await wallet.connect();
  return wallet;
}

export async function disconnectInjectedWallet() {
  const wallet = getInjectedWallet();
  if (wallet && wallet.disconnect) {
    await wallet.disconnect();
  }
}

export function ensureMainnetConnection() {
  return new Connection(MAINNET_RPC_URL, "confirmed");
}

export async function executeSerializedTransactions(
  serializedTransactions: string[],
  connection: Connection
) {
  const wallet = await connectInjectedWallet();
  const signatures: string[] = [];

  for (let index = 0; index < serializedTransactions.length; index += 1) {
    const bytes = decodeBase64(serializedTransactions[index]);
    const transaction = VersionedTransaction.deserialize(bytes);

    if (wallet.signAndSendTransaction) {
      const result = await wallet.signAndSendTransaction(transaction);
      signatures.push(normalizeSignature(result.signature));
      continue;
    }

    if (!wallet.signTransaction) {
      throw new Error("Connected wallet does not support transaction signing.");
    }

    const signed = await wallet.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());
    signatures.push(signature);
  }

  return signatures;
}

export function shortenAddress(value: string) {
  if (!value) return "n/a";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeSignature(signature: unknown) {
  return typeof signature === "string" ? signature : String(signature);
}
