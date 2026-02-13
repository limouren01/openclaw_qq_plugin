import {
  logInboundDrop,
  resolveControlCommandGate,
  type OpenClawConfig,
  type PluginRuntime,
} from "openclaw/plugin-sdk";

import type { ResolvedQQAccount } from "./types.js";
import {
  resolveQQDmPolicy,
  resolveQQGroupAllow,
  resolveQQGroupPolicy,
} from "./policy.js";
import { sendQQMessage } from "./send.js";
import { getQQRuntime } from "./runtime.js";
import { downloadQQMedia } from "./download.js";
import type { ParsedQQMessage } from "./message-parser.js";

const CHANNEL_ID = "qq" as const;

async function deliverQQReply(params: {
  payload: { text?: string; mediaUrl?: string; replyToId?: string };
  targetId: string;
  accountId: string;
  config: any;
}): Promise<void> {
  const { payload, targetId, accountId, config } = params;
  const text = payload.text ?? "";
  const mediaUrl = payload.mediaUrl;

  if (!text.trim() && !mediaUrl) return;

  await sendQQMessage(accountId, targetId, text, config);
}

export async function handleQQInbound(params: {
  message: ParsedQQMessage;
  account: ResolvedQQAccount;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  botSelfId: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, botSelfId, statusSink } = params;
  const core = getQQRuntime();

  const rawBody = message.rawBody;
  if (!rawBody) {
    runtime.log?.(
      `qq: drop message with empty raw_body: senderId=${message.senderId}, chatType=${message.chatType}, body="${message.body}"`
    );
    return;
  }

  const isGroup = message.chatType === "group";
  const senderId = message.senderId;
  const senderName = message.senderName;
  const chatId = message.chatId;

  // console.log(`[QQ Gateway DEBUG] inbound.ts 初始化: chatId=${chatId}, senderId=${senderId}, message.chatType=${message.chatType}`);

  statusSink?.({ lastInboundAt: message.timestamp });

  const dmPolicy = account.config.dmPolicy ?? "open";
  const defaultGroupPolicy = config.channels?.defaults?.groupPolicy;
  const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "disabled";

  const allowFrom = (account.config.allowFrom ?? []).map(String);
  const storeAllowFrom = await core.channel.pairing
    .readAllowFromStore(CHANNEL_ID)
    .catch(() => []);

  const effectiveAllowFrom = [...allowFrom, ...storeAllowFrom].filter(Boolean);

  // console.log(`[QQ Gateway DEBUG] Policy check: dmPolicy=${dmPolicy}, groupPolicy=${groupPolicy}, allowFrom=[${allowFrom.join(',')}], effectiveAllowFrom=[${effectiveAllowFrom.join(',')}]`);
  // console.log(`[QQ Gateway DEBUG] Message check: chatType=${message.chatType}, senderId=${senderId}, chatId=${chatId}`);



  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const useAccessGroups = config.commands?.useAccessGroups !== false;

  const senderAllowedForCommands = effectiveAllowFrom.length === 0 ||
    effectiveAllowFrom.includes(senderId);
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config);
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [
      {
        configured: effectiveAllowFrom.length > 0,
        allowed: senderAllowedForCommands,
      },
    ],
    allowTextCommands,
    hasControlCommand,
  });
  const commandAuthorized = commandGate.commandAuthorized;

  if (isGroup) {
    const groupAllow = resolveQQGroupAllow({
      groupPolicy,
      allowFrom: effectiveAllowFrom,
      senderId,
      senderName,
    });
    // console.log(`[QQ Gateway DEBUG] Group allow check: allowed=${groupAllow.allowed}, reason=${groupAllow.reason}`);
    if (!groupAllow.allowed) {
      runtime.log?.(
        `qq: drop group sender ${senderId} (policy=${groupPolicy})`,
      );
      // console.log(`[QQ Gateway DEBUG] Message DROPPED: sender ${senderId}, reason=${groupAllow.reason}`);
      return;
    }
    // console.log(`[QQ Gateway DEBUG] Group message ALLOWED: sender ${senderId}`);
  } else {
    if (dmPolicy !== "open") {
      const dmAllowed = effectiveAllowFrom.length === 0 ||
        effectiveAllowFrom.includes(senderId);
      // console.log(`[QQ Gateway DEBUG] DM allow check: dmAllowed=${dmAllowed}, dmPolicy=${dmPolicy}`);
      if (!dmAllowed) {
        runtime.log?.(
          `qq: drop DM sender ${senderId} (dmPolicy=${dmPolicy})`,
        );
        // console.log(`[QQ Gateway DEBUG] Message DROPPED: sender ${senderId}`);
        return;
      }
    }
  }

  if (isGroup && commandGate.shouldBlock) {
    logInboundDrop({
      log: (message) => runtime.log?.(message),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderId,
    });
    return;
  }

  // 消息通过所有策略检查后，下载媒体文件
  // 解析媒体大小限制
  const mediaMaxBytes = (account.config.mediaMaxMb ?? 20) * 1024 * 1024;

  // 下载媒体文件
  let downloadedMedia: typeof message.mediaAttachments = undefined;
  if (message.mediaAttachments && message.mediaAttachments.length > 0) {
    try {
      const mediaPromises = message.mediaAttachments.map((attachment) =>
        downloadQQMedia(attachment, mediaMaxBytes),
      );
      downloadedMedia = await Promise.all(mediaPromises);
      // console.log(
      //   `[QQ Gateway] Downloaded ${downloadedMedia.length} media file(s)`,
      // );
    } catch (error) {
      // console.error(
      //   `[QQ Gateway] Failed to download media: ${error instanceof Error ? error.message : String(error)}`,
      // );
      // 下载失败时继续处理，但不包含媒体
    }
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "dm",
      id: chatId,
    },
  });

  const fromLabel = isGroup
    ? (message.groupSubject || `群 ${chatId}`)
    : `${senderName} (${senderId})`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatInboundEnvelope({
    channel: "QQ",
    from: fromLabel,
    timestamp: message.timestamp,
    body: message.body,
    previousTimestamp,
    envelope: envelopeOptions,
    senderLabel: senderName,
  });

  const groupSystemPrompt = undefined; // QQ目前不支持群系统提示

  // 构建媒体路径信息
  const mediaPath = downloadedMedia?.[0]?.path;
  const mediaType = downloadedMedia?.[0]?.contentType;
  const mediaPaths = downloadedMedia?.map((m) => m.path).filter(Boolean);
  const mediaTypes = downloadedMedia?.map((m) => m.contentType).filter(Boolean);

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? `group:${chatId}` : `qq:${senderId}`,
    To: `qq:${botSelfId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName,
    SenderId: senderId,
    GroupSubject: isGroup ? message.groupSubject : undefined,
    GroupSystemPrompt: isGroup ? groupSystemPrompt : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `qq:${botSelfId}`,
    CommandAuthorized: commandAuthorized,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
    MediaPaths: mediaPaths,
    MediaTypes: mediaTypes,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`qq: failed updating session meta: ${String(err)}`);
    },
  });

  // 记录发送给核心的消息（这是通过所有过滤后的最终消息）
  runtime.log?.(
    `[QQ → 核心] ${isGroup ? '群' : '私聊'} | 发送者: ${senderName}(${senderId}) | 会话: ${fromLabel} | 内容: ${rawBody.substring(0, 100)}${rawBody.length > 100 ? '...' : ''}`
  );

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
      dispatcherOptions: {
      deliver: async (payload) => {
        // console.log(`[QQ Gateway DEBUG] deliverQQReply 调用: targetId=${chatId}, chatType=${isGroup ? "group" : "direct"}`);
        await deliverQQReply({
          payload: payload as {
            text?: string;
            mediaUrl?: string;
            replyToId?: string;
          },
          targetId: chatId,
          accountId: account.accountId,
          config: account.config,
        });
      },
      onError: (err, info) => {
        runtime.error?.(
          `qq ${info.kind} reply failed: ${String(err)}`,
        );
      },
    },
    replyOptions: {
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
    dispatcherOptions: {
      deliver: async (payload) => {
        // console.log(`[QQ Gateway DEBUG] deliverQQReply 调用: targetId=${chatId}, chatType=${isGroup ? "group" : "direct"}`);
        await deliverQQReply({
          payload: payload as {
            text?: string;
            mediaUrl?: string;
            replyToId?: string;
          },
          targetId: chatId,
          accountId: account.accountId,
          config: account.config,
        });
      },
      onError: (err, info) => {
        runtime.error?.(
          `qq ${info.kind} reply failed: ${String(err)}`,
        );
      },
    },
  });

  statusSink?.({ lastOutboundAt: Date.now() });
}
