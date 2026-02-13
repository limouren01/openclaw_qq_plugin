// @ts-nocheck
import type { OpenClawConfig } from "openclaw/plugin-sdk";

export type QQAccountConfig = {
  host?: string;
  port?: number;
  token?: string;
  bindHost?: string;
  bindPort?: number;
  dmPolicy?: "open" | "allowlist" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  allowFrom?: string[];
  groupAllowFrom?: string[];
  blockStreaming?: boolean;
  skills?: string[];
  mediaMaxMb?: number;
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

/**
 * 媒体附件类型
 */
export type QQMediaAttachment = {
  type: "image" | "record" | "video";
  url: string;
  file: string;
  path?: string;
  contentType?: string;
};