import { API_URL } from "./constants";

export interface DatasetSummary {
  id: string;
  owner: string;
  metadataHash: string;
  licenseType: "Flat" | "PerQuery" | "PerEpoch";
  price: string;
  epochSeconds: number | null;
  registeredAt: string;
  licenseCount: number;
  ledgerSeq: number | null;
  txHash: string | null;
}

export interface LicenseSummary {
  id: number;
  licensee: string;
  token: string;
  termsType: "Flat" | "PerQuery" | "PerEpoch";
  price: string;
  epochSeconds: number | null;
  status: "Active" | "Revoked";
  purchasedAt: string;
  usageCount: string;
  payable: string;
  settledTotal: string;
}

export interface UsageRecord {
  reporter: string;
  usageCount: string;
  delta: string;
  recordedAt: string;
  ledgerSeq: number | null;
  txHash: string | null;
}

export interface Settlement {
  amount: string;
  caller: string;
  settledAt: string;
  ledgerSeq: number | null;
  txHash: string | null;
}

export interface LicenseDetail {
  id: number;
  dataset: {
    id: string;
    owner: string;
    metadataHash: string;
    licenseType: "Flat" | "PerQuery" | "PerEpoch";
    price: string;
    epochSeconds: number | null;
  };
  licensee: string;
  token: string;
  termsType: "Flat" | "PerQuery" | "PerEpoch";
  price: string;
  epochSeconds: number | null;
  status: "Active" | "Revoked";
  purchasedAt: string;
  usageCount: string;
  payable: string;
  settledTotal: string;
  lastSettleTs: string;
  usageRecords: UsageRecord[];
  settlements: Settlement[];
  revocation: {
    revokedBy: string;
    revokedAt: string;
  } | null;
}

const MAX_LIMIT = 100;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export function getDatasets(
  opts: { owner?: string; limit?: number; offset?: number } = {}
): Promise<{ datasets: DatasetSummary[]; pagination: { total: number } }> {
  const params = new URLSearchParams();
  if (opts.owner) params.set("owner", opts.owner);
  params.set("limit", String(Math.min(opts.limit ?? 50, MAX_LIMIT)));
  params.set("offset", String(opts.offset ?? 0));
  return request(`/api/datasets?${params.toString()}`);
}

export function getDatasetLicenses(id: string): Promise<{
  datasetId: string;
  licenseCount: number;
  totalRecordedUsage: string;
  licenses: LicenseSummary[];
}> {
  return request(`/api/datasets/${encodeURIComponent(id)}/licenses`);
}

export function getLicense(id: number): Promise<LicenseDetail> {
  return request(`/api/licenses/${id}`);
}