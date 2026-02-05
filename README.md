# QQ/Napcat (OpenClaw plugin)

QQ channel plugin powered by **Napcat** (OneBot 11 implementation).

## Author

limouren

## Installation

**Note:** If you're unsure where to install the plugin, run `openclaw plugins list` to determine the correct plugin installation path based on your OpenClaw installation method. Installation paths may vary depending on whether you installed OpenClaw via npm, pnpm, or shell scripts. Please verify the actual location based on your installation.

Example output from `openclaw plugins list`:

```
│ QQ           │ qq       │ loaded   │ ~/.local/share/pnpm/global/5/.pnpm/ │ 2026.2.2 │
│              │          │          │ openclaw@2026.2.1_@napi-            │          │
│              │          │          │ rs+canvas@0.1.89_@types+express@5.  │          │
│              │          │          │ 0.6_node-llama-cpp@3.15.1_signal-   │          │
│              │          │          │ polyfill@0.2.2/node_modules/        │          │
│              │          │          │ openclaw/extensions/qq/src/index.ts │          │
│              │          │          │ QQ channel plugin via Napcat        │          │
```

Based on the plugin path shown above (e.g., `openclaw/extensions/qq/`), place the `qq` folder under the `extensions` directory.

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
