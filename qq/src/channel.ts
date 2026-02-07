// @ts-nocheck
import {
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  getChatChannelMeta,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";

import { getQQRuntime } from "./runtime.js";
import { resolveQQAccount } from "./config.js";
import type { ResolvedQQAccount } from "./types.js";
import { sendQQMessage, sendQQMediaMessage, probeNapcatConnection } from "./send.js";
import { monitorNapcatProvider } from "./monitor.js";

const meta = getChatChannelMeta("qq");

export const qqPlugin: ChannelPlugin<ResolvedQQAccount> = {
  id: "qq",
  meta: {
    ...meta,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    polls: false,
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
  },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        bindHost: {
          type: "string",
          description: "WebSocket server bind address (Napcat connects to this)",
          default: "127.0.0.1",
        },
        bindPort: {
          type: "number",
          description: "WebSocket server port (Napcat connects to this)",
          default: 8082,
        },
        token: {
          type: "string",
          description: "Napcat access token",
        },
      },
    },
  },
  config: {
    listAccountIds: (cfg) => {
      const accounts = cfg.channels?.qq?.accounts;
      if (!accounts || typeof accounts !== "object") return [DEFAULT_ACCOUNT_ID];
      const ids = Object.keys(accounts).filter(Boolean);
      return ids.length > 0 ? ids.sort((a, b) => a.localeCompare(b)) : [DEFAULT_ACCOUNT_ID];
    },
    resolveAccount: (cfg, accountId) =>
      resolveQQAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID }),
    defaultAccountId: (cfg) => {
      const ids = qqPlugin.config!.listAccountIds(cfg);
      if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
      return ids[0] ?? DEFAULT_ACCOUNT_ID;
    },
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "qq",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "qq",
        accountId,
        clearBaseFields: ["token", "name"],
      }),
    isConfigured: (account) => Boolean(account.token?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.token?.trim()),
    }),
    resolveAllowFrom: ({ account }) =>
      (account?.config?.allowFrom ?? []).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  messaging: {
    normalizeTarget: (input) => {
      const normalized = input.trim();
      if (normalized.startsWith("qq:")) {
        return normalized.replace(/^qq:/i, "");
      }
      if (normalized.startsWith("user:")) {
        return normalized.replace(/^user:/i, "");
      }
      if (normalized.startsWith("group:")) {
        return normalized.replace(/^group:/i, "");
      }
      return normalized;
    },
    targetResolver: {
      looksLikeId: (input) => /^(\d+|(qq|user|group):\d+)$/i.test(input.trim()),
      hint: "<userId|groupId|user:ID|group:ID|qq:ID>",
    },
  },
  threading: {
    buildToolContext: ({ context }) => {
      // For replies, use 'From' (the sender) not 'To' (which might be bot itself)
      return {
        currentChannelId: context.From?.trim() || undefined,
        currentChannelProvider: context.Channel as any,
      };
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: null,
    textChunkLimit: 2000,
    pollMaxOptions: 0,
    sendText: async ({ to, text, accountId, replyToId }) => {
      const runtime = getQQRuntime();
      const account = resolveQQAccount({ cfg: runtime.config, accountId });
      const result = await sendQQMessage(
        account.accountId,
        to,
        text,
        account.config,
      );
      return { channel: "qq", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      const runtime = getQQRuntime();
      const account = resolveQQAccount({ cfg: runtime.config, accountId });

      // 动态导入 loadWebMedia
      const { loadWebMedia } = await import("openclaw/plugin-sdk");

      try {
        // 加载媒体
        const media = await loadWebMedia(mediaUrl);
        const caption = text || "";

        // 构建消息段数组
        const segments = [];

        // 添加配文
        if (caption.trim()) {
          segments.push({ type: "text", data: { text: caption } });
        }

        // 根据媒体类型创建消息段
        let mediaSegment;
        const base64Data = media.buffer.toString("base64");

        switch (media.kind) {
          case "image":
            mediaSegment = {
              type: "image",
              data: { file: `base64://${base64Data}` }
            };
            break;
          case "audio":
            mediaSegment = {
              type: "record",
              data: { file: `base64://${base64Data}` }
            };
            break;
          case "video":
            mediaSegment = {
              type: "video",
              data: { file: `base64://${base64Data}` }
            };
            break;
          case "document":
            // 文档类型，使用图片类型发送文件
            mediaSegment = {
              type: "image",
              data: {
                file: `base64://${base64Data}`,
                summary: media.fileName || "document"
              }
            };
            break;
          default:
            // 未知类型，降级为 URL 文本
            const fallbackMessage = caption ? `${caption}\n${mediaUrl}` : mediaUrl;
            const result = await sendQQMessage(
              account.accountId,
              to,
              fallbackMessage,
              account.config,
            );
            return { channel: "qq", ...result };
        }

        segments.push(mediaSegment);

        // 发送媒体消息
        const result = await sendQQMediaMessage(
          account.accountId,
          to,
          segments,
          account.config,
        );
        return { channel: "qq", ...result };
      } catch (error) {
        // 加载媒体失败，降级为发送 URL 文本
        const fallbackMessage = text ? `${text}\n${mediaUrl}` : mediaUrl;
        const result = await sendQQMessage(
          account.accountId,
          to,
          fallbackMessage,
          account.config,
        );
        return { channel: "qq", ...result };
      }
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: () => [],
    buildChannelSummary: async ({ snapshot, account }) => {
      const configured = Boolean(account.token?.trim());
      return {
        configured,
        linked: configured,
        running: snapshot.running ?? false,
        connected: snapshot.connected ?? false,
        lastStartAt: snapshot.lastStartAt ?? null,
        lastStopAt: snapshot.lastStopAt ?? null,
        lastError: snapshot.lastError ?? null,
      };
    },
    probeAccount: async ({ account, timeoutMs }) => {
      const result = await probeNapcatConnection(account.accountId, account.config, timeoutMs);
      return result;
    },
    buildAccountSnapshot: async ({ account, runtime, probe }) => {
      const configured = Boolean(account.token?.trim());
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        linked: configured,
        running: runtime?.running ?? false,
        connected: runtime?.connected ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
    resolveAccountState: ({ configured }) => (configured ? "linked" : "not linked"),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const token = account.token.trim();
      if (!token) {
        throw new Error(`Napcat token is required for account ${account.accountId}`);
      }
      ctx.log?.info(`[${account.accountId}] starting QQ provider`);
      return monitorNapcatProvider({
        accountId: account.accountId,
        config: account.config,
        cfg: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        setStatus: ctx.setStatus,
        log: ctx.log,
      });
    },
  },
};
