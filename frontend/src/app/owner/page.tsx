"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard-header";
import { TermsBadge } from "@/components/terms-badge";
import { useWallet } from "@/lib/use-wallet";
import {
  getDatasets,
  getDatasetLicenses,
  type DatasetSummary,
  type LicenseSummary,
} from "@/lib/api";
import {
  registerDataset,
  revokeLicense,
  isContractConfigured,
  type LicenseKind,
} from "@/lib/contract";
import { formatAmount, shortId, timeAgo, isValidHex32 } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const KINDS: LicenseKind[] = ["Flat", "PerQuery", "PerEpoch"];

export default function OwnerPage() {
  const { address, busy, connect, disconnect } = useWallet();
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [licensesByDataset, setLicensesByDataset] = useState<Record<string, LicenseSummary[]>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const [datasetId, setDatasetId] = useState("");
  const [metadataHash, setMetadataHash] = useState("");
  const [kind, setKind] = useState<LicenseKind>("PerQuery");
  const [price, setPrice] = useState("1000000");
  const [epochSeconds, setEpochSeconds] = useState("86400");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setApiError(null);
    try {
      const { datasets } = await getDatasets({ owner: address, limit: 100 });
      setDatasets(datasets);
      const entries = await Promise.all(
        datasets.map(async (d) => {
          try {
            const res = await getDatasetLicenses(d.id);
            return [d.id, res.licenses] as const;
          } catch {
            return [d.id, [] as LicenseSummary[]] as const;
          }
        })
      );
      setLicensesByDataset(Object.fromEntries(entries));
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to load datasets");
      setDatasets([]);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totals = useMemo(() => {
    let earned = 0n;
    let active = 0;
    for (const licenses of Object.values(licensesByDataset)) {
      for (const lic of licenses) {
        earned += BigInt(lic.settledTotal);
        if (lic.status === "Active") active += 1;
      }
    }
    return { earned, active };
  }, [licensesByDataset]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    if (!isValidHex32(datasetId) || !isValidHex32(metadataHash)) {
      toast.error("Dataset id and metadata hash must be 32-byte hex (64 characters)");
      return;
    }
    let parsedPrice: bigint;
    try {
      parsedPrice = BigInt(price);
      if (parsedPrice < 0n) throw new Error("negative");
    } catch {
      toast.error("Price must be a non-negative integer amount in smallest token units");
      return;
    }
    if (kind === "PerEpoch") {
      const seconds = Number(epochSeconds);
      if (!Number.isInteger(seconds) || seconds <= 0) {
        toast.error("PerEpoch licenses require a positive epoch length in seconds");
        return;
      }
    }
    setSubmitting(true);
    try {
      await registerDataset({
        owner: address,
        datasetId,
        metadataHash,
        licenseKind: kind,
        price: parsedPrice.toString(),
        epochSeconds: kind === "PerEpoch" ? Number(epochSeconds) : undefined,
      });
      toast.success("Dataset registered on-chain");
      setDatasetId("");
      setMetadataHash("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (datasetId: string, licenseId: number) => {
    if (!address) return;
    if (!window.confirm(`Revoke license #${licenseId}? Its usage and settlement will stop.`)) return;
    try {
      await revokeLicense({ caller: address, datasetId, licenseId });
      toast.success(`License #${licenseId} revoked`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revocation failed");
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <DashboardHeader
        title="Owner dashboard"
        subtitle="Register datasets, set licensing terms, and collect royalties."
        address={address}
        busy={busy}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4">
        {!isContractConfigured() && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            NEXT_PUBLIC_CONTRACT_ID is not set — the frontend can&apos;t invoke the
            contract. Configure it in <code>.env.local</code>.
          </p>
        )}

        {!address ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Connect your wallet</CardTitle>
                <CardDescription>
                  Connect Freighter to register datasets and manage your licenses.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={connect} disabled={busy}>
                  {busy ? "Connecting…" : "Connect Freighter"}
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Datasets</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {datasets?.length ?? "—"}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Active licenses</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {datasets ? totals.active : "—"}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Royalties settled</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {datasets ? formatAmount(totals.earned) : "—"}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Register a dataset</CardTitle>
                <CardDescription>
                  Dataset id and metadata hash are 32-byte hex values (64 characters). The
                  metadata hash should be a content-address for your dataset&apos;s metadata file.
                  Prices are entered in the token&apos;s smallest units (e.g. stroops for XLM).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRegister} className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="datasetId">Dataset id (hex)</Label>
                    <Input
                      id="datasetId"
                      placeholder="0x… (64 hex chars)"
                      value={datasetId}
                      onChange={(e) => setDatasetId(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="metadataHash">Metadata hash (hex)</Label>
                    <Input
                      id="metadataHash"
                      placeholder="0x… (64 hex chars)"
                      value={metadataHash}
                      onChange={(e) => setMetadataHash(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>License terms</Label>
                    <div className="flex gap-2">
                      {KINDS.map((k) => (
                        <Button
                          key={k}
                          type="button"
                          size="sm"
                          variant={kind === k ? "default" : "outline"}
                          onClick={() => setKind(k)}
                        >
                          {k}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {kind === "Flat"
                        ? "One-time fee collected at purchase."
                        : kind === "PerQuery"
                          ? "Pay-per-usage; royalties accrue per reported query."
                          : "Recurring fee per epoch that elapses between settlements."}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="price">
                        Price (smallest units)
                      </Label>
                      <Input
                        id="price"
                        type="text"
                        inputMode="numeric"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </div>
                    {kind === "PerEpoch" && (
                      <div className="space-y-2">
                        <Label htmlFor="epochSeconds">Epoch length (seconds)</Label>
                        <Input
                          id="epochSeconds"
                          type="number"
                          min={1}
                          value={epochSeconds}
                          onChange={(e) => setEpochSeconds(e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2 flex items-center justify-end gap-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? "Registering…" : "Register dataset"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Your datasets</CardTitle>
                <CardDescription>
                  Licenses for each dataset, with earned royalties. Only the dataset
                  owner can revoke a license.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {apiError && (
                  <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Could not load datasets from the API: {apiError}
                  </p>
                )}
                {datasets && datasets.length === 0 && !apiError && (
                  <p className="text-sm text-muted-foreground">
                    No datasets registered yet. Register one above.
                  </p>
                )}
                {datasets?.map((d) => (
                  <div key={d.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm" title={d.id}>
                          {shortId(d.id)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <TermsBadge
                            type={d.licenseType}
                            price={d.price}
                            epochSeconds={d.epochSeconds}
                          />
                          <Badge variant="outline">{d.licenseCount} licenses</Badge>
                          <span>Registered {timeAgo(d.registeredAt)}</span>
                        </div>
                      </div>
                    </div>

                    <Table className="mt-3">
                      <TableHeader>
                        <TableRow>
                          <TableHead>License</TableHead>
                          <TableHead>Licensee</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Usage</TableHead>
                          <TableHead className="text-right">Earned</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(licensesByDataset[d.id] ?? []).map((lic) => (
                          <TableRow key={lic.id}>
                            <TableCell className="font-mono text-xs">#{lic.id}</TableCell>
                            <TableCell className="font-mono text-xs" title={lic.licensee}>
                              {shortId(lic.licensee)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={lic.status === "Active" ? "secondary" : "outline"}
                              >
                                {lic.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{lic.usageCount}</TableCell>
                            <TableCell className="text-right text-xs">
                              {formatAmount(lic.settledTotal)}
                            </TableCell>
                            <TableCell className="text-right">
                              {lic.status === "Active" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRevoke(d.id, lic.id)}
                                >
                                  Revoke
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(licensesByDataset[d.id] ?? []).length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={6}
                              className="py-4 text-center text-muted-foreground"
                            >
                              No licenses yet.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}