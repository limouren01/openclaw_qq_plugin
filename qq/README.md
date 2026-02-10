# QQ/Napcat (OpenClaw plugin)

QQ channel plugin powered by **Napcat** (OneBot 11 implementation).

## Author

limouren

## Enable

Bundled plugins are disabled by default. Enable this one:



Restart the Gateway after enabling.

## Configuration

Add your QQ channel configuration to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "qq": {
      "enabled": true,
      "accounts": {
        "YOUR_BOT_QQ_NUMBER": {
          "token": "YOUR_NAPCAT_TOKEN",
          "bindHost": "127.0.0.1",
          "bindPort": 8082,
          "allowFrom": ["YOUR_QQ_NUMBER"]
        }
      }
    }
  }
}
```

### Configuration Fields

| Field | Description | Required |
|--------|-------------|-----------|
| `YOUR_BOT_QQ_NUMBER` | Your bot's QQ number (as account ID) | Yes |
| `token` | Napcat access token for authentication | Yes |
| `bindHost` | WebSocket server bind address | No (default: 127.0.0.1) |
| `bindPort` | WebSocket server bind port | No (default: 8082) |
| `allowFrom` | List of allowed QQ numbers (whitelist) | No (default: allow all) |
| `mediaMaxMb` | Maximum media file size to download (MB) | No (default: 20) |

### Media Support

QQ plugin supports receiving and processing images, voice messages, and videos.

#### Image Recognition

To enable AI image recognition for QQ messages, you need to configure a multi-modal model:

```json
{
  "tools": {
    "media": {
      "image": {
        "enabled": true,
        "models": [
          {
            "provider": "siliconflow",
            "model": "zai-org/GLM-4.6V"
          }
        ]
      }
    }
  }
}
```

**Important Requirements:**

1. **Model must support vision**: The model you configure must be a multi-modal model that supports image input (e.g., GLM-4V, GLM-4.6V, gpt-4o, claude-3.5-sonnet)
2. **Update model input declaration**: Ensure the model's `input` field includes `"image"`:

```json
{
  "models": {
    "providers": {
      "siliconflow": {
        "baseUrl": "https://api.siliconflow.cn/v1",
        "apiKey": "your-api-key",
        "api": "openai-completions",
        "models": [
          {
            "id": "zai-org/GLM-4.6V",
            "name": "Silicon GLM 4.6V",
            "reasoning": false,
            "input": [
              "text",
              "image"
            ],
            "contextWindow": 128000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

**How it works:**

- When a user sends an image in QQ, the plugin downloads it to `~/.openclaw/media/inbound/`
- The image is automatically processed through your configured vision model
- The AI receives a description of the image along with any accompanying text
- You can use other vision-capable providers (OpenAI, Anthropic, Google, MiniMax)

**Default behavior:**

- If `tools.media.image` is not configured, OpenClaw attempts to use a default vision model
- Default limit: 20MB per media file (configurable via `mediaMaxMb`)
- Images larger than the limit are skipped with a warning in logs

### Access Control

Configure access policies for private messages (DM) and group messages:

- `dmPolicy`: `"open"` (allow all) or `"allowlist"` (whitelist only)
- `groupPolicy`: `"open"` (allow all) or `"allowlist"` (whitelist only)
- `allowFrom`: Array of QQ numbers to allow when using `"allowlist"`

Example:

```json
{
  "channels": {
    "qq": {
      "enabled": true,
      "accounts": {
        "3589774615": {
          "token": "yourtoken",
          "bindHost": "127.0.0.1",
          "bindPort": 8082,
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": ["your qq number"]
        }
      }
    }
  }
}
```

## Napcat Setup

This plugin uses **reverse WebSocket** mode: OpenClaw starts a WebSocket server, and Napcat connects to it.

### Configure Napcat

Edit your Napcat `config.yml`:

```yaml
# WebSocket reverse connection
ws:
  reverseUrls:
    - url: ws://127.0.0.1:8082
      headers:
        Authorization: Bearer YOUR_NAPCAT_TOKEN
        X-Self-Id: your bot qq number
```

### Key Points


- Replace `YOUR_NAPCAT_TOKEN` with the token from your OpenClaw config
- Napcat will connect to OpenClaw automatically on startup
- Messages from allowed QQ numbers are forwarded to OpenClaw for AI processing

## Notes

- Heartbeat messages are filtered and not sent to the AI model
- Only text messages from `post_type: "message"` are processed
- Meta events (heartbeat, lifecycle) are ignored
- Supports both private messages and group messages
- Message segments (text, images, at mentions, etc.) are converted to text for AI processing

## Troubleshooting

### Messages not received

1. Check if Napcat is running and connected:
   ```bash
   openclaw channels status --probe
   ```

2. Verify Napcat `config.yml` has correct WebSocket URL and token
3. Check OpenClaw logs for connection errors:
   ```bash
   tail -f ~/.openclaw/gateway.log | grep "QQ Gateway"
   ```


### Plugin not detected by core

Ensure `qq` is enabled in plugins configuration:
```json
{
  "plugins": {
    "entries": {
      "qq": {
        "enabled": true
      }
    }
  }
}
```

Restart the Gateway after enabling the plugin.
