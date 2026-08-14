"use client";

import Link from "next/link";
import { ConnectButton } from "@/components/connect-button";

interface DashboardHeaderProps {
  title: string;
  subtitle: string;
  address: string | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function DashboardHeader({
  title,
  subtitle,
  address,
  busy,
  onConnect,
  onDisconnect,
}: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Corpuslane
          </Link>
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link
              href="/owner"
              className={`rounded-md px-3 py-1.5 ${
                title === "Owner dashboard"
                  ? "bg-muted text-foreground"
                  : "hover:bg-muted/60"
              }`}
            >
              Owners
            </Link>
            <Link
              href="/licensee"
              className={`rounded-md px-3 py-1.5 ${
                title === "Licensee dashboard"
                  ? "bg-muted text-foreground"
                  : "hover:bg-muted/60"
              }`}
            >
              Licensees
            </Link>
          </nav>
        </div>
        <ConnectButton
          address={address}
          busy={busy}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </header>
  );
}