// @ts-nocheck
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type { QQAccountConfig, ResolvedQQAccount } from "./types.js";

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = cfg.channels?.qq?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listQQAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultQQAccountId(cfg: OpenClawConfig): string {
  const ids = listQQAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): QQAccountConfig | undefined {
  const accounts = cfg.channels?.qq?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId] as QQAccountConfig | undefined;
}

function mergeQQAccountConfig(cfg: OpenClawConfig, accountId: string): QQAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.qq ?? {}) as QQAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function resolveQQAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedQQAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.qq?.enabled !== false;
  const merged = mergeQQAccountConfig(params.cfg, accountId);
  const accountEnabled = (merged as any).enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const token = merged.token ?? "";

  return {
    accountId,
    enabled,
    name: (merged as any).name?.trim() || undefined,
    token,
    config: merged,
  };
}

export function listEnabledQQAccounts(cfg: OpenClawConfig): ResolvedQQAccount[] {
  return listQQAccountIds(cfg)
    .map((accountId) => resolveQQAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}