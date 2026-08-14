"use client";

import {
  Address,
  Asset,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import {
  getAddress,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { CONTRACT_ID, MAX_LIVE_UNTIL_LEDGER, NETWORK_PASSPHRASE, RPC_URL } from "./constants";

export type LicenseKind = "Flat" | "PerQuery" | "PerEpoch";

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

const server = new Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

// ---------------------------------------------------------------------------
// Freighter helpers
// ---------------------------------------------------------------------------

export async function connectWallet(): Promise<string> {
  const connected = await isConnected();
  if (!connected.isConnected) {
    const granted = await requestAccess();
    if (granted.error || !granted.address) {
      throw new ContractError("Freighter access was not granted");
    }
  }
  const pubkey = await getAddress();
  if (pubkey.error || !pubkey.address) {
    throw new ContractError("Could not read a public key from Freighter");
  }
  return pubkey.address;
}

// ---------------------------------------------------------------------------
// ScVal builders
// ---------------------------------------------------------------------------

/** Hex (with or without 0x prefix) -> BytesN<32> ScVal. */
export function hexToScVal32(hex: string): xdr.ScVal {
  const clean = hex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new ContractError("Dataset id / metadata hash must be 32 bytes of hex (64 chars)");
  }
  const bytes = Buffer.from(clean, "hex");
  return xdr.ScVal.scvBytes(bytes);
}

/** strkey (G…/C…) -> Address ScVal. */
export function addressToScVal(strkey: string): xdr.ScVal {
  if (!StrKey.isValidEd25519PublicKey(strkey) && !StrKey.isValidContract(strkey)) {
    throw new ContractError(`Not a valid Stellar address: ${strkey}`);
  }
  return new Address(strkey).toScVal();
}

export function i128ScVal(value: string | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "i128" });
}

export function u64ScVal(value: string | bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

export function u32ScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

/** Resolves a payment-token input into a Soroban token contract address.
 *  Accepts either a C… contract id (any SEP-41 token) or an asset spec whose
 *  Stellar Asset Contract address is derived deterministically:
 *    - "XLM" or "native"  -> native asset SAC
 *    - "CODE:ISSUER"      -> issued-asset SAC (e.g. "USDC:GB…")
 *  Throws ContractError for anything else. */
export function resolveTokenAddress(input: string): string {
  const spec = input.trim();
  if (!spec) throw new ContractError("Enter a payment token");
  if (StrKey.isValidContract(spec)) return spec;
  if (/^(xlm|native)$/i.test(spec)) {
    return Asset.native().contractId(NETWORK_PASSPHRASE);
  }
  const m = /^([A-Za-z0-9]{1,12}):(G[A-Z0-9]{55})$/.exec(spec);
  if (m && StrKey.isValidEd25519PublicKey(m[2])) {
    return new Asset(m[1], m[2]).contractId(NETWORK_PASSPHRASE);
  }
  throw new ContractError(
    'Token must be a C… contract id, "XLM", or "CODE:ISSUER" (e.g. USDC:GB…)'
  );
}

/** contracttype enum -> Vec[Symbol(variant), ...fields] (matches soroban-sdk). */
export function licenseTermsToScVal(
  kind: LicenseKind,
  price: string,
  epochSeconds?: number
): xdr.ScVal {
  const clean = price.replace(/^0+/, "") || "0";
  const vals = [xdr.ScVal.scvSymbol(kind), i128ScVal(clean)];
  if (kind === "PerEpoch") {
    if (!epochSeconds || epochSeconds <= 0) {
      throw new ContractError("PerEpoch terms require a positive epoch length (seconds)");
    }
    vals.push(u64ScVal(epochSeconds));
  }
  return xdr.ScVal.scvVec(vals);
}

// ---------------------------------------------------------------------------
// Transaction plumbing
// ---------------------------------------------------------------------------

export interface InvokeResult {
  hash: string;
  status: string;
}

async function invokeContract(
  publicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[]
): Promise<InvokeResult> {
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .setTimeout(60)
    .addOperation(contract.call(method, ...args))
    .build();

  let simulated;
  try {
    simulated = await server.simulateTransaction(tx);
  } catch (err) {
    throw new ContractError(`Simulation failed: ${(err as Error).message}`);
  }
  if ("error" in simulated && simulated.error) {
    throw new ContractError(`Simulation returned an error: ${simulated.error}`);
  }
  if (!("result" in simulated) || !simulated.result) {
    throw new ContractError("Simulation produced no result");
  }
  // restore any simulated authorization entries (allowances consumed etc.)
  const prepped = assembleTransaction(tx, simulated);
  const preppedXdr = prepped.build().toXDR();

  const signed = await signTransaction(preppedXdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTx = TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);
  const sendResponse = await server.sendTransaction(signedTx);

  const { status, hash } = sendResponse;
  if (status === "ERROR") {
    const err = (sendResponse as { errorResult?: { result: { code: number } } })
      .errorResult;
    throw new ContractError(`Transaction failed: ${err?.result?.code ?? "unknown"}`);
  }

  // Poll for final status.
  for (let i = 0; i < 12; i++) {
    const txStatus = await server.getTransaction(hash);
    if (txStatus.status === "SUCCESS") {
      return { hash, status: "SUCCESS" };
    }
    if (txStatus.status === "FAILED") {
      throw new ContractError(`Transaction ${hash} failed on chain`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { hash, status: "PENDING" };
}

// ---------------------------------------------------------------------------
// Corpuslane contract calls
// ---------------------------------------------------------------------------

function requireContractId() {
  if (!CONTRACT_ID) {
    throw new ContractError(
      "NEXT_PUBLIC_CONTRACT_ID is not configured in the frontend environment"
    );
  }
  return CONTRACT_ID;
}

export function registerDataset(args: {
  owner: string;
  datasetId: string;
  metadataHash: string;
  licenseKind: LicenseKind;
  price: string;
  epochSeconds?: number;
}): Promise<InvokeResult> {
  return invokeContract(args.owner, requireContractId(), "register_dataset", [
    addressToScVal(args.owner),
    hexToScVal32(args.datasetId),
    hexToScVal32(args.metadataHash),
    licenseTermsToScVal(args.licenseKind, args.price, args.epochSeconds),
  ]);
}

export function purchaseLicense(args: {
  licensee: string;
  datasetId: string;
  token: string;
  payment: string;
}): Promise<InvokeResult> {
  return invokeContract(args.licensee, requireContractId(), "purchase_license", [
    hexToScVal32(args.datasetId),
    addressToScVal(args.licensee),
    addressToScVal(args.token),
    i128ScVal(args.payment),
  ]);
}

export function setAttestor(args: {
  caller: string;
  datasetId: string;
  attestor: string;
}): Promise<InvokeResult> {
  return invokeContract(args.caller, requireContractId(), "set_attestor", [
    hexToScVal32(args.datasetId),
    addressToScVal(args.caller),
    addressToScVal(args.attestor),
  ]);
}

export function recordUsage(args: {
  caller: string;
  licenseId: number;
  usageCount: number;
}): Promise<InvokeResult> {
  return invokeContract(args.caller, requireContractId(), "record_usage", [
    u64ScVal(args.licenseId),
    addressToScVal(args.caller),
    u32ScVal(Math.max(0, Math.floor(args.usageCount))),
  ]);
}

export function settle(
  caller: string,
  licenseId: number
): Promise<InvokeResult> {
  return invokeContract(caller, requireContractId(), "settle", [
    u64ScVal(licenseId),
    addressToScVal(caller),
  ]);
}

export function revokeLicense(args: {
  caller: string;
  datasetId: string;
  licenseId: number;
}): Promise<InvokeResult> {
  return invokeContract(args.caller, requireContractId(), "revoke_license", [
    hexToScVal32(args.datasetId),
    addressToScVal(args.caller),
    u64ScVal(args.licenseId),
  ]);
}

/** Approves the token contract so Corpuslane can move `amount` on the
 *  licensee's behalf (required for purchases and settlements). */
export function approveToken(args: {
  from: string;
  token: string;
  amount: string;
}): Promise<InvokeResult> {
  return invokeContract(args.from, args.token, "approve", [
    addressToScVal(args.from),
    addressToScVal(requireContractId()),
    i128ScVal(args.amount),
    u32ScVal(MAX_LIVE_UNTIL_LEDGER),
  ]);
}

export function isContractConfigured(): boolean {
  return Boolean(CONTRACT_ID);
}