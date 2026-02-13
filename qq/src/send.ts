import * as WebSocket from "ws";

export interface SendQQMessageResult {
  id: string;
  timestamp: number;
}

// 导出供 send.ts 外部使用的连接引用
export const getSharedConnection = (accountId: string): WebSocket | undefined => {
  const { sharedConnections } = require("./monitor.js");
  return sharedConnections.get(accountId)?.ws;
};

// Napcat OneBot 11 消息段类型
export interface NapcatMessageSegment {
  type: string;
  data: Record<string, any>;
}

export async function sendQQMessage(
  accountId: string,
  target: string,
  message: string,
  _config?: {
    host?: string;
    port?: number;
    token?: string;
    bindHost?: string;
    bindPort?: number;
  },
): Promise<SendQQMessageResult> {
  return sendQQMessageWithSegments(accountId, target, [
    { type: "text", data: { text: message } },
  ]);
}

export async function sendQQMediaMessage(
  accountId: string,
  target: string,
  segments: NapcatMessageSegment[],
  _config?: {
    host?: string;
    port?: number;
    token?: string;
    bindHost?: string;
    bindPort?: number;
  },
): Promise<SendQQMessageResult> {
  return sendQQMessageWithSegments(accountId, target, segments);
}

async function sendQQMessageWithSegments(
  accountId: string,
  target: string,
  messageSegments: NapcatMessageSegment[],
): Promise<SendQQMessageResult> {
  // 从 monitor.ts 获取共享连接
  const ws = getSharedConnection(accountId);

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error(`No active connection for account ${accountId}`);
  }

  return new Promise((resolve, reject) => {
    const messageId = `qq-send-${Date.now()}`;

    // Napcat OneBot 11 API 格式
    const userId = parseInt(target, 10);
    // console.log(`[QQ Gateway DEBUG] sendQQMessage: target=${target}, parsed userId=${userId}`);

    const payload = {
      action: "send_private_msg",
      params: {
        user_id: userId,
        message: messageSegments,
      },
      echo: messageId,
    };

    let completed = false;

    const handler = (data: Buffer) => {
      if (completed) return;

      try {
        const response = JSON.parse(data.toString());

        // 检查是否是我们发送的消息的响应
        if (response.echo === messageId) {
          if (response.retcode === 0) {
            completed = true;
            ws.off("message", handler);
            resolve({
              id: response.data?.message_id?.toString() || messageId,
              timestamp: Date.now(),
            });
          } else {
            completed = true;
            ws.off("message", handler);
            reject(new Error(`Failed to send message: ${response.message || response.wording || "Unknown error"}`));
          }
        }
      } catch (error) {
        if (!completed) {
          completed = true;
          ws.off("message", handler);
          reject(error);
        }
      }
    };

    ws.on("message", handler);
    ws.send(JSON.stringify(payload));

    // 超时处理
    setTimeout(() => {
      if (!completed) {
        completed = true;
        ws.off("message", handler);
        reject(new Error("Send message timeout"));
      }
    }, 10000);
  });
}

export async function probeNapcatConnection(
  accountId: string,
  config: {
    host?: string;
    port?: number;
    token?: string;
    bindHost?: string;
    bindPort?: number;
  },
  _timeoutMs: number = 5000,
): Promise<{ ok: boolean; message: string; bot?: any }> {
  // 在反向连接模式下，probe 只是检查是否已有活跃连接
  const ws = getSharedConnection(accountId);

  if (ws && ws.readyState === WebSocket.OPEN) {
    return { ok: true, message: "Active connection found" };
  }

  // 如果没有活跃连接，返回提示用户需要启动 Napcat
  return {
    ok: false,
    message: `No active connection for account ${accountId}. Please ensure Napcat is configured to connect to ws://${config.bindHost || "0.0.0.0"}:${config.bindPort || 8082}.`,
  };
}
