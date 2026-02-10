import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { QQMediaAttachment } from "./types.js";

/**
 * 获取配置目录
 */
function getMediaDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, ".openclaw", "media", "inbound");
}

/**
 * 确保媒体目录存在
 */
async function ensureMediaDir(): Promise<string> {
  const mediaDir = getMediaDir();
  await fs.mkdir(mediaDir, { recursive: true });
  return mediaDir;
}

/**
 * 检测 MIME 类型（通过 magic bytes）
 */
function detectMimeType(buffer: Buffer): string {
  if (buffer.length >= 2) {
    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      return "image/jpeg";
    }
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "image/png";
    }
    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return "image/gif";
    }
    // WebP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return "image/webp";
    }
    // MP4
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
      return "video/mp4";
    }
    // OGG (SILK/Vorbis)
    if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
      return "audio/ogg";
    }
    // MP3
    if (buffer[0] === 0xff && buffer[1] === 0xfb) {
      return "audio/mpeg";
    }
  }

  return "application/octet-stream";
}

/**
 * 根据 MIME 类型获取文件扩展名
 */
function getExtensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "video/mp4":
      return ".mp4";
    case "audio/ogg":
      return ".ogg";
    case "audio/mpeg":
      return ".mp3";
    default:
      return ".bin";
  }
}

/**
 * 清理文件名
 */
function sanitizeFilename(name: string): string {
  // 移除或替换不安全的字符
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

/**
 * 下载 QQ 媒体文件（图片、语音、视频）
 */
export async function downloadQQMedia(
  attachment: QQMediaAttachment,
  maxBytes: number = 20 * 1024 * 1024, // 默认 20MB
): Promise<QQMediaAttachment> {
  const { url, file, type } = attachment;

  try {
    // 1. 下载文件
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download QQ media: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. 检查文件大小
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `QQ media file (${file}) exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit: ${Math.round(buffer.byteLength / (1024 * 1024))}MB`,
      );
    }

    // 3. 检测 MIME 类型
    const mimeType = detectMimeType(buffer);

    // 4. 保存到磁盘
    const mediaDir = await ensureMediaDir();
    const sanitizedFileName = sanitizeFilename(file);
    const ext = getExtensionForMimeType(mimeType);
    const uuid = crypto.randomUUID();
    const destFileName = `${sanitizedFileName}---${uuid}${ext}`;
    const destPath = path.join(mediaDir, destFileName);

    await fs.writeFile(destPath, buffer, { mode: 0o600 });

    console.log(
      `[QQ Gateway] Downloaded ${type} media to ${destPath} (${buffer.length} bytes, ${mimeType})`,
    );

    // 5. 返回下载后的附件信息
    return {
      type,
      url,
      file,
      path: destPath,
      contentType: mimeType,
    };
  } catch (error) {
    console.error(
      `[QQ Gateway] Failed to download media ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}
