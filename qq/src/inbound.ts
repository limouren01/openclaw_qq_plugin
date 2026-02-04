import {
  logInboundDrop,
  resolveControlCommandGate,
  type ClawdbotConfig,
  type RuntimeEnv,
} from "clawdbot/plugin-sdk";

import type { ResolvedQQAccount } from "./types.js";
import {
  resolveQQDmPolicy,
  resolveQQGroupAllow,
  resolveQQGroupPolicy,
} from "./policy.js";
import { sendQQMessage } from "./send.js";
import { getQQRuntime } from "./runtime.js";
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
  config: ClawdbotConfig;
  runtime: RuntimeEnv;
  botSelfId: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, botSelfId, statusSink } = params;
  const core = getQQRuntime();

  const rawBody = message.rawBody;
  if (!rawBody) return;

  const isGroup = message.chatType === "group";
  const senderId = message.senderId;
  const senderName = message.senderName;
  const chatId = message.chatId;

  statusSink?.({ lastInboundAt: message.timestamp });

  const dmPolicy = account.config.dmPolicy ?? "open";
  const defaultGroupPolicy = config.channels?.defaults?.groupPolicy;
  const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "open";

  const allowFrom = (account.config.allowFrom ?? []).map(String);
  const storeAllowFrom = await core.channel.pairing
    .readAllowFromStore(CHANNEL_ID)
    .catch(() => []);

  const effectiveAllowFrom = [...allowFrom, ...storeAllowFrom].filter(Boolean);

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
    if (!groupAllow.allowed) {
      runtime.log?.(
        `qq: drop group sender ${senderId} (policy=${groupPolicy})`,
      );
      return;
    }
  } else {
    if (dmPolicy !== "open") {
      const dmAllowed = effectiveAllowFrom.length === 0 ||
        effectiveAllowFrom.includes(senderId);
      if (!dmAllowed) {
        runtime.log?.(
          `qq: drop DM sender ${senderId} (dmPolicy=${dmPolicy})`,
        );
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
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`qq: failed updating session meta: ${String(err)}`);
    },
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload) => {
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
  });

  statusSink?.({ lastOutboundAt: Date.now() });
}
