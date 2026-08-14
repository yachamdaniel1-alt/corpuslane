"use client";

import { useCallback, useEffect, useState } from "react";
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
  approveToken,
  isContractConfigured,
  purchaseLicense,
  recordUsage,
  resolveTokenAddress,
  settle,
} from "@/lib/contract";
import { TOKEN_APPROVAL_AMOUNT } from "@/lib/constants";
import { formatAmount, shortId, timeAgo } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface OwnedLicense {
  dataset: DatasetSummary;
  license: LicenseSummary;
}

export default function LicenseePage() {
  const { address, busy, connect, disconnect } = useWallet();

  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [owned, setOwned] = useState<OwnedLicense[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [purchaseTokens, setPurchaseTokens] = useState<Record<string, string>>({});
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [usageInputs, setUsageInputs] = useState<Record<string, string>>({});
  const [reporting, setReporting] = useState<number | null>(null);
  const [settling, setSettling] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    setApiError(null);
    try {
      const { datasets } = await getDatasets({ limit: 100 });
      setDatasets(datasets);
      const mine: OwnedLicense[] = [];
      for (const d of datasets) {
        try {
          const res = await getDatasetLicenses(d.id);
          for (const lic of res.licenses) {
            if (lic.licensee === address) mine.push({ dataset: d, license: lic });
          }
        } catch {
          /* dataset may have no indexed licenses yet */
        }
      }
      setOwned(mine);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to load datasets");
      setDatasets([]);
    }
  }, [address]);

  const handleApproveAndPurchase = async (d: DatasetSummary) => {
    if (!address) return;
    let token: string;
    try {
      token = resolveTokenAddress(purchaseTokens[d.id] ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid payment token");
      return;
    }
    setPurchasing(d.id);
    try {
      await approveToken({ from: address, token, amount: TOKEN_APPROVAL_AMOUNT });
      const payment = d.licenseType === "Flat" ? d.price : "0";
      await purchaseLicense({ licensee: address, datasetId: d.id, token, payment });
      toast.success(
        d.licenseType === "Flat"
          ? "License purchased and paid"
          : "License opened — usage now accrues"
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setPurchasing(null);
    }
  };

  const handleReportUsage = async (lic: LicenseSummary) => {
    if (!address) return;
    const raw = usageInputs[lic.id] ?? "";
    const count = Number(raw);
    if (!Number.isInteger(count) || count <= 0) {
      toast.error("Enter a positive integer number of queries");
      return;
    }
    setReporting(lic.id);
    try {
      await recordUsage({ caller: address, licenseId: lic.id, usageCount: count });
      toast.success(`Reported ${count} queries on license #${lic.id}`);
      setUsageInputs((prev) => ({ ...prev, [lic.id]: "" }));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Usage reporting failed");
    } finally {
      setReporting(null);
    }
  };

  const handleSettle = async (lic: LicenseSummary) => {
    if (!address) return;
    setSettling(lic.id);
    try {
      await approveToken({ from: address, token: lic.token, amount: TOKEN_APPROVAL_AMOUNT });
      await settle(address, lic.id);
      toast.success(`License #${lic.id} settled`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Settlement failed");
    } finally {
      setSettling(null);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <DashboardHeader
        title="Licensee dashboard"
        subtitle="Browse datasets, purchase licenses, report usage, and settle royalties."
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
                  Connect Freighter to purchase licenses and manage usage for datasets.
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
            <Card>
              <CardHeader>
                <CardTitle>Browse datasets</CardTitle>
                <CardDescription>
                  Flat licenses are paid in full at purchase. PerQuery and PerEpoch licenses
                  accrue royalties that you settle later. Enter the Soroban token contract you
                  want to pay with (it must be approved before settlement).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {apiError && (
                  <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Could not load datasets from the API: {apiError}
                  </p>
                )}
                {datasets && datasets.length === 0 && !apiError && (
                  <p className="text-sm text-muted-foreground">
                    No datasets available yet.
                  </p>
                )}
                {datasets?.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
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
                      <p className="mt-1 max-w-xl truncate text-xs text-muted-foreground" title={d.owner}>
                        Owner {shortId(d.owner)}
                      </p>
                    </div>
                    <div className="flex w-full items-end gap-2 sm:w-auto">
                      <div className="w-full sm:w-64">
                        <Input
                          placeholder="Token: C…, XLM, or CODE:ISSUER"
                          className="font-mono text-xs"
                          value={purchaseTokens[d.id] ?? ""}
                          onChange={(e) =>
                            setPurchaseTokens((prev) => ({ ...prev, [d.id]: e.target.value }))
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="whitespace-nowrap"
                        disabled={Boolean(purchaseTokens[d.id])}
                        onClick={() =>
                          setPurchaseTokens((prev) => ({ ...prev, [d.id]: "XLM" }))
                        }
                        title="Use the native asset's Stellar Asset Contract"
                      >
                        XLM
                      </Button>
                      <Button
                        onClick={() => handleApproveAndPurchase(d)}
                        disabled={purchasing === d.id}
                        className="whitespace-nowrap"
                      >
                        {purchasing === d.id
                          ? "Purchasing…"
                          : d.licenseType === "Flat"
                            ? `Purchase · ${formatAmount(d.price)}`
                            : "Purchase"}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {owned.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Your licenses</CardTitle>
                  <CardDescription>
                    For PerQuery licenses you can report usage and then settle. For PerEpoch,
                    settling accrues the elapsed epochs first. Settlement pulls the owed amount
                    from your approved token allowance to the dataset owner.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>License</TableHead>
                        <TableHead>Dataset</TableHead>
                        <TableHead>Terms</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Usage</TableHead>
                        <TableHead className="text-right">Payable</TableHead>
                        <TableHead className="text-right">Settled</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {owned.map(({ dataset, license }) => (
                        <TableRow key={license.id}>
                          <TableCell className="font-mono text-xs">#{license.id}</TableCell>
                          <TableCell className="font-mono text-xs" title={dataset.id}>
                            {shortId(dataset.id)}
                          </TableCell>
                          <TableCell>
                            <TermsBadge
                              type={license.termsType}
                              price={license.price}
                              epochSeconds={license.epochSeconds}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant={license.status === "Active" ? "secondary" : "outline"}>
                              {license.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">{license.usageCount}</TableCell>
                          <TableCell className="text-right text-xs">
                            {formatAmount(license.payable)}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {formatAmount(license.settledTotal)}
                          </TableCell>
                          <TableCell className="text-right">
                            {license.status === "Active" && license.termsType === "PerQuery" && (
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  placeholder="Δ"
                                  className="h-8 w-16 font-mono text-xs"
                                  value={usageInputs[license.id] ?? ""}
                                  onChange={(e) =>
                                    setUsageInputs((prev) => ({ ...prev, [license.id]: e.target.value }))
                                  }
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={reporting === license.id}
                                  onClick={() => handleReportUsage(license)}
                                >
                                  {reporting === license.id ? "…" : "Report"}
                                </Button>
                              </div>
                            )}
                            {license.status === "Active" && license.termsType !== "Flat" && (
                              <Button
                                size="sm"
                                className="ml-1"
                                disabled={settling === license.id}
                                onClick={() => handleSettle(license)}
                              >
                                {settling === license.id ? "…" : "Settle"}
                              </Button>
                            )}
                            {license.termsType === "Flat" && (
                              <span className="text-xs text-muted-foreground">
                                Paid in full
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Note: PerQuery usage is self-reported unless your dataset&apos;s owner has
                    delegated an attestor. Under-reporting is possible — see SECURITY.md.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}