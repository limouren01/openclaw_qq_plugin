// Napcat OneBot 消息解析器

import type { QQMediaAttachment } from "./types.js";

/**
 * Napcat OneBot 11 消息事件类型
 */
export interface NapcatMessageEvent {
  post_type: "message" | "notice" | "request" | "meta_event";
  message_type?: "private" | "group";
  sub_type?: string;
  time?: number;
  self_id?: number;
  user_id?: number;
  group_id?: number;
  message_id?: number;
  message?: Array<NapcatMessageSegment>;
  raw_message?: string;
  font?: number;
  sender?: {
    user_id: number;
    nickname: string;
    card?: string;
  };
  notice_type?: string;
  status?: string;
  retcode?: number;
  data?: any;
  message_format?: string;
  target_id?: number;
}

/**
 * Napcat 消息段
 */
export interface NapcatMessageSegment {
  type: string;
  data: {
    text?: string;
    [key: string]: any;
  };
}

/**
 * 解析后的QQ消息
 */
export interface ParsedQQMessage {
  // 基本信息
  messageId: string;
  timestamp: number;
  body: string;
  rawBody: string;

  // 发送者信息
  senderId: string;
  senderName: string;
  senderNickname?: string;

  // 聊天信息
  chatType: "direct" | "group";
  chatId: string;
  groupSubject?: string;

  // 媒体附件
  mediaAttachments?: QQMediaAttachment[];

  // 是否为消息
  isValidMessage: boolean;
}

/**
 * 解析Napcat消息
 */
export function parseNapcatMessage(message: NapcatMessageEvent): ParsedQQMessage | null {
  // 忽略非消息类型的事件（notice, request, meta_event等）
  if (message.post_type !== "message") {
    return null;
  }

  // 检查是否为有效的消息类型
  const messageType = message.message_type;
  if (!messageType || (messageType !== "private" && messageType !== "group")) {
    return null;
  }

  // 提取发送者信息
  const senderId = message.sender?.user_id?.toString() || message.user_id?.toString();
  const senderName = message.sender?.nickname || message.sender?.card || `User${senderId}`;

  // 提取消息内容
  const rawBody = message.raw_message || "";
  const body = extractTextFromMessageSegments(message.message || []);

  // 确定聊天类型和ID
  const isGroup = messageType === "group";
  const chatType: "direct" | "group" = isGroup ? "group" : "direct";
  const chatId = isGroup
    ? message.group_id?.toString() || ""
    : message.target_id?.toString() || senderId;

  // 消息ID
  const messageId = message.message_id?.toString() || `qq-${Date.now()}-${Math.random()}`;

  // 时间戳
  const timestamp = message.time ? message.time * 1000 : Date.now();
  //console.log(`[QQ Gateway DEBUG] parseNapcatMessage: senderId=${senderId}, chatId=${chatId}, chatType=${chatType}, messageType=${messageType}, post_type=${message.post_type}, user_id=${message.user_id}, self_id=${message.self_id}`);

  // 提取媒体附件
  const mediaAttachments = extractMediaAttachments(message.message || []);

  return {
    messageId,
    timestamp,
    body,
    rawBody,
    senderId,
    senderName,
    senderNickname: message.sender?.card,
    chatType,
    chatId,
    groupSubject: isGroup ? `群 ${chatId}` : undefined,
    mediaAttachments,
    isValidMessage: true,
  };
}

/**
 * 从消息段数组中提取文本
 */
function extractTextFromMessageSegments(segments: NapcatMessageSegment[]): string {
  if (!Array.isArray(segments)) return "";

  const textParts: string[] = [];

  for (const segment of segments) {
    if (segment.type === "text" && segment.data?.text) {
      textParts.push(segment.data.text);
    } else if (segment.type === "image" && segment.data?.file) {
      textParts.push(`[图片: ${segment.data.file}]`);
    } else if (segment.type === "face" && segment.data?.id) {
      textParts.push(`[表情: ${segment.data.id}]`);
    } else if (segment.type === "at") {
      const qq = segment.data?.qq;
      textParts.push(qq ? `@${qq}` : "@某人");
    } else if (segment.type === "record") {
      textParts.push("[语音消息]");
    } else if (segment.type === "video") {
      textParts.push("[视频]");
    } else if (segment.type === "share") {
      textParts.push(`[分享: ${segment.data?.title || "链接"}]`);
    } else if (segment.type === "json") {
      textParts.push("[JSON消息]");
    } else {
      // 其他类型的消息段，简单记录
      textParts.push(`[${segment.type}]`);
    }
  }

  return textParts.join("");
}

/**
 * 从消息段数组中提取媒体附件
 */
function extractMediaAttachments(segments: NapcatMessageSegment[]): QQMediaAttachment[] {
  const attachments: QQMediaAttachment[] = [];

  for (const segment of segments) {
    if (segment.type === "image" && segment.data?.url && segment.data?.file) {
      attachments.push({
        type: "image",
        url: segment.data.url,
        file: segment.data.file,
      });
    } else if (segment.type === "record" && segment.data?.url && segment.data?.file) {
      attachments.push({
        type: "record",
        url: segment.data.url,
        file: segment.data.file,
      });
    } else if (segment.type === "video" && segment.data?.url && segment.data?.file) {
      attachments.push({
        type: "video",
        url: segment.data.url,
        file: segment.data.file,
      });
    }
  }

  return attachments;
}



