"use client";

import { useState, useCallback } from "react";
import { connectWallet } from "@/lib/contract";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const addr = await connectWallet();
      setAddress(addr);
      return addr;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  return { address, busy, connect, disconnect };
}