import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Registered provenance",
    body: "Datasets are registered on-chain with a content-addressed metadata hash and immutable licensing terms.",
  },
  {
    title: "Flat or metered terms",
    body: "License once with a flat fee, or pay per query / per training epoch with royalties accrued on-chain.",
  },
  {
    title: "Settled on chain",
    body: "Owners claim royalties directly to their wallets. Every payment and usage record is auditable.",
  },
  {
    title: "Attestation support",
    body: "Owners can delegate usage reporting to trusted attestors, keeping metered accounts honest without a central server.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-4xl mx-auto w-full text-center">
        <Badge variant="secondary" className="mb-4">
          Stellar Soroban
        </Badge>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
          Corpuslane
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
          Licensing and usage-metered royalties for AI training datasets. Clear
          terms, on-chain provenance, and auditable revenue.
        </p>

        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/owner"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Dataset owners
          </Link>
          <Link
            href="/licensee"
            className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-8 text-sm font-medium hover:bg-accent"
          >
            Licensees
          </Link>
        </div>
      </div>

      <div className="mt-20 grid gap-6 md:grid-cols-2 max-w-4xl mx-auto w-full">
        {features.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle className="text-base">{f.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm leading-relaxed">
                {f.body}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}