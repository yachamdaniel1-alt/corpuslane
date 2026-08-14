import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats an i128 amount (smallest token units, as a decimal string) into a
 *  human-readable number using a token's decimal places. */
export function formatAmount(
  raw: string | bigint | number,
  decimals = 7
): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const padded = abs.toString().padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return `${sign}${intPart}${fracPart ? `.${fracPart}` : ""}`;
}

/** Shortens a strkey / hex identifier for display. */
export function shortId(id: string, head = 8, tail = 6): string {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function timeAgo(iso: string | Date): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function isValidHex32(hex: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(hex);
}