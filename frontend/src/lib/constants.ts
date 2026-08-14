export const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org:443";

export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Amount approved on the payment token for the Corpuslane contract, in
 *  smallest token units. Large enough for testnet metered usage. */
export const TOKEN_APPROVAL_AMOUNT = "1000000000000000000";

export const MAX_LIVE_UNTIL_LEDGER = 4_294_967_295;