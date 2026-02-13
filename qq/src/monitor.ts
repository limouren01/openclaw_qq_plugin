import * as WebSocket from "ws";
import { EventEmitter } from "events";
import { createServer, Server as HttpServer } from "http";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import {
  parseNapcatMessage,
  type NapcatMessageEvent,
  type ParsedQQMessage,
} from "./message-parser.js";
import { handleQQInbound } from "./inbound.js";
import type { ResolvedQQAccount } from "./types.js";
import { resolveQQAccount } from "./config.js";

interface NapcatConnection {
  ws: WebSocket;
  connected: boolean;
  accountId: string;
  lastMessageTime: number;
  heartbeatInterval?: ReturnType<typeof setInterval>;
}

export interface MonitorNapcatOpts {
  accountId: string;
  config: {
    host?: string;
    port?: number;
    token?: string;
    bindHost?: string;
    bindPort?: number;
  };
  cfg?: OpenClawConfig;
  runtime?: PluginRuntime;
  abortSignal?: AbortSignal;
  onMessage?: (message: ParsedQQMessage) => void;
  setStatus: (status: any) => void;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

// 共享的 WebSocket 服务器实例（跨多个账户）
export let sharedWsServer: WebSocket.Server | null = null;
let sharedHttpServer: HttpServer | null = null;
export let sharedConnections = new Map<string, NapcatConnection>();
let sharedEventEmitter = new EventEmitter();

export async function monitorNapcatProvider(opts: MonitorNapcatOpts) {
  const { accountId, config, abortSignal, onMessage, setStatus, log } = opts;

  const bindHost = config.bindHost || "0.0.0.0";
  const bindPort = config.bindPort || 8082;
  const token = config.token;

  if (!token) {
    throw new Error(`Napcat token is required for account ${accountId}`);
  }

  const logInfo = log?.info ? log.info.bind(log) : console.log;
  const logWarn = log?.warn ? log.warn.bind(log) : console.warn;
  const logError = log?.error ? log.error.bind(log) : console.error;

  const startHeartbeat = (connection: NapcatConnection) => {
    connection.heartbeatInterval = setInterval(() => {
      if (!connection.connected) return;

      const elapsed = Date.now() - connection.lastMessageTime;
      if (elapsed > 30000) {
        // logWarn(`[QQ Gateway] No message from ${connection.accountId} for ${elapsed}ms, sending ping...`);
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.ping();
        }
      }

      if (elapsed > 60000) {
        // logWarn(`[QQ Gateway] Connection stale for account ${connection.accountId}, closing...`);
        connection.ws.close();
      }
    }, 10000);
  };

  // 如果没有共享服务器，创建一个
  if (!sharedWsServer) {
    sharedHttpServer = createServer();
    sharedWsServer = new WebSocket.Server({ server: sharedHttpServer });

    sharedWsServer.on("connection", (ws: WebSocket.WebSocket, req: any) => {
      // 验证 Authorization header 中的 token
      const authHeader = req.headers["authorization"];
      const clientToken = authHeader?.replace("Bearer ", "");

      if (clientToken !== token) {
        logWarn(`[QQ Gateway] Rejecting connection with invalid token`);
        ws.close(1008, "Invalid token");
        return;
      }

      const connectionAccountId = req.headers["x-self-id"]?.toString() || accountId;

      // logInfo(`[QQ Gateway] New connection from account ${connectionAccountId}`);

      const connection: NapcatConnection = {
        ws,
        connected: true,
        accountId: connectionAccountId,
        lastMessageTime: Date.now(),
      };

      sharedConnections.set(connectionAccountId, connection);
      startHeartbeat(connection);

      sharedEventEmitter.emit("connected", connectionAccountId);

      ws.on("message", (data: Buffer) => {
        connection.lastMessageTime = Date.now();

        try {
          const messageStr = data.toString();
          // logInfo(`[QQ Gateway] Received message from ${connectionAccountId}: ${messageStr}`);
          const message = JSON.parse(messageStr) as NapcatMessageEvent;

          // 解析Napcat消息
          const parsedMessage = parseNapcatMessage(message);

          // 只转发有效的消息，忽略通知、API响应等
          if (parsedMessage && parsedMessage.isValidMessage) {
            //logInfo(`[QQ Gateway] Parsed message successfully: sender=${parsedMessage.senderId}, chatType=${parsedMessage.chatType}, body="${parsedMessage.body}"`);
            sharedEventEmitter.emit("napcat-message", connectionAccountId, message, parsedMessage);
          } else {
            //logInfo(`[QQ Gateway] Message not forwarded: post_type=${message.post_type}, message_type=${message.message_type}, parsed=${parsedMessage ? "yes" : "no"}`);
            if (message.status && message.retcode && message.retcode !== 0) {
              // 忽略API错误响应
              // logWarn(`[QQ Gateway] Ignoring API error: ${message.message || "Unknown error"}`);
            }
          }
        } catch (error) {
          logError(`[QQ Gateway] Failed to parse message: ${error}, raw: ${data.toString()}`);
        }
      });

      ws.on("close", (code: number, reason: Buffer) => {
        // logWarn(
        //   `[QQ Gateway] Connection closed for account ${connectionAccountId}: ${code} ${reason?.toString() || "unknown"}`,
        // );
        connection.connected = false;

        if (connection.heartbeatInterval) {
          clearInterval(connection.heartbeatInterval);
        }

        sharedConnections.delete(connectionAccountId);
        sharedEventEmitter.emit("disconnected", connectionAccountId);
      });

      ws.on("error", (error: Error) => {
        // logError(`[QQ Gateway] Error for account ${connectionAccountId}: ${error}`);
      });

      ws.on("pong", () => {
        connection.lastMessageTime = Date.now();
      });
    });

  sharedWsServer.on("error", (error: Error) => {
    // logError(`[QQ Gateway] WebSocket server error: ${error}`);
  });

  await new Promise<void>((resolve) => {
      sharedHttpServer!.listen(bindPort, bindHost, () => {
        // logInfo(`[QQ Gateway] WebSocket server listening on ${bindHost}:${bindPort}`);
        resolve();
      });
    });
  }

  const messageHandler = async (msgAccountId: string, rawMessage: NapcatMessageEvent, parsedMessage: ParsedQQMessage) => {
    if (msgAccountId === accountId && parsedMessage) {
      // logInfo(`[QQ Gateway] Processing message for account ${accountId}`);

      try {
        if (opts.cfg && opts.runtime) {
          const account = resolveQQAccount({ cfg: opts.cfg, accountId });
          await handleQQInbound({
            message: parsedMessage,
            account,
            config: opts.cfg,
            runtime: opts.runtime,
            botSelfId: msgAccountId,
            statusSink: (patch) => {
              if (patch.lastInboundAt) {
                // logInfo(`[QQ Gateway] Last inbound at: ${new Date(patch.lastInboundAt).toISOString()}`);
              }
            },
          });
        } else if (opts.onMessage) {
          // Fallback to simple onMessage if cfg/runtime not provided
          opts.onMessage(parsedMessage);
        } else {
          // logWarn(`[QQ Gateway] Cannot process message: cfg and runtime not provided`);
        }
      } catch (error) {
        logError(`[QQ Gateway] Error processing message: ${error}`);
        logError(`[QQ Gateway] Error stack: ${error instanceof Error ? error.stack : "No stack"}`);
        logError(`[QQ Gateway] Message data: sender=${parsedMessage.senderId}, chatType=${parsedMessage.chatType}, body="${parsedMessage.body}"`);
      }
    }
  };

  const connectionHandler = (connectedAccountId: string) => {
    if (connectedAccountId === accountId) {
      // logInfo(`[QQ Gateway] Account ${connectedAccountId} connected`);
      setStatus({ accountId: connectedAccountId, running: true, connected: true, lastStartAt: Date.now(), lastError: null });
    }
  };

  const disconnectionHandler = (disconnectedAccountId: string) => {
    if (disconnectedAccountId === accountId) {
      // logWarn(`[QQ Gateway] Account ${disconnectedAccountId} disconnected`);
      setStatus({ accountId: disconnectedAccountId, running: false, connected: false, lastStopAt: Date.now() });
    }
  };

  sharedEventEmitter.on("napcat-message", messageHandler);
  sharedEventEmitter.on("connected", connectionHandler);
  sharedEventEmitter.on("disconnected", disconnectionHandler);

  // 检查是否已连接
  if (sharedConnections.has(accountId)) {
    const conn = sharedConnections.get(accountId);
    setStatus({ accountId, running: true, connected: conn?.connected ?? true, lastStartAt: Date.now(), lastError: null });
  }

  if (abortSignal) {
    abortSignal.addEventListener("abort", () => {
      // logInfo(`[QQ Gateway] Aborting for account ${accountId}`);
      sharedEventEmitter.off("napcat-message", messageHandler);
      sharedEventEmitter.off("connected", connectionHandler);
      sharedEventEmitter.off("disconnected", disconnectionHandler);
    });
  }

  return async () => {
    // logInfo(`[QQ Gateway] Stopping for account ${accountId}`);
    sharedEventEmitter.off("napcat-message", messageHandler);
    sharedEventEmitter.off("connected", connectionHandler);
    sharedEventEmitter.off("disconnected", disconnectionHandler);

    const connection = sharedConnections.get(accountId);
    if (connection?.connected) {
      connection.ws.close();
      if (connection.heartbeatInterval) {
        clearInterval(connection.heartbeatInterval);
      }
    }
    sharedConnections.delete(accountId);

    // 如果没有其他连接，关闭服务器
    if (sharedConnections.size === 0) {
      sharedWsServer?.close();
      sharedHttpServer?.close();
      sharedWsServer = null;
      sharedHttpServer = null;
    }
  };
}
