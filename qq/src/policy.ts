import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { ResolvedQQAccount } from "./types.js";

export function resolveQQDmPolicy(account?: ResolvedQQAccount): "open" | "allowlist" {
  return account?.config.dmPolicy ?? "open";
}

export function resolveQQGroupAllow(params: {
  groupPolicy: "open" | "allowlist";
  allowFrom: string[];
  senderId: string;
  senderName: string;
}): { allowed: boolean; reason?: string } {
  const { groupPolicy, allowFrom, senderId, senderName } = params;

  if (groupPolicy === "open") {
    return { allowed: true };
  }

  if (allowFrom.length === 0) {
    return { allowed: true };
  }

  const allowed = allowFrom.includes(senderId);
  return {
    allowed,
    reason: allowed ? undefined : `sender ${senderName} (${senderId}) not in allowlist`,
  };
}
