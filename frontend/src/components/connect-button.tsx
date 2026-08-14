"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { shortId } from "@/lib/utils";

interface ConnectButtonProps {
  address: string | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectButton({
  address,
  busy,
  onConnect,
  onDisconnect,
}: ConnectButtonProps) {
  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
          title={address}
        >
          {shortId(address)}
        </span>
        <Button variant="outline" size="sm" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" onClick={onConnect} disabled={busy}>
      {busy ? "Connecting…" : "Connect Freighter"}
    </Button>
  );
}