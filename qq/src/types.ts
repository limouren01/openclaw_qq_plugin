// @ts-nocheck
import type { OpenClawConfig } from "openclaw/plugin-sdk";

export type QQAccountConfig = {
  host?: string;
  port?: number;
  token?: string;
  bindHost?: string;
  bindPort?: number;
  dmPolicy?: "open" | "allowlist" | "disabled";
  groupPolicy?: "open" | "allowlist";
  allowFrom?: string[];
  groupAllowFrom?: string[];
  blockStreaming?: boolean;
  skills?: string[];
};

export type ResolvedQQAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  config: QQAccountConfig;
  dmPolicy?: string;
  groupPolicy?: string;
  allowFrom?: string[];
  groupAllowFrom?: string[];
};