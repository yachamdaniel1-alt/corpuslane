"use client";

import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/utils";

export interface Terms {
  type: "Flat" | "PerQuery" | "PerEpoch";
  price: string;
  epochSeconds: number | null;
}

export function TermsBadge({ type, price, epochSeconds }: Terms) {
  if (type === "PerEpoch") {
    const perDay = Math.max(1, Math.round((86400 / (epochSeconds ?? 1)) * 100) / 100);
    return (
      <Badge variant="secondary" title={`${price} units per ${epochSeconds}s epoch`}>
        PerEpoch · {formatAmount(price)}/epoch{epochSeconds ? ` (~${perDay}/day)` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {type} · {formatAmount(price)}
    </Badge>
  );
}