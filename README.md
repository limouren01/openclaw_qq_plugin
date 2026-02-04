# QQ/Napcat (Clawdbot plugin)

QQ channel plugin powered by **Napcat** (OneBot 11 implementation).

## Author

limouren

## Enable

Bundled plugins are disabled by default. Enable this one:



Restart the Gateway after enabling.

## Configuration

Add your QQ channel configuration to `~/.clawdbot/clawdbot.json`:

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

This plugin uses **reverse WebSocket** mode: Clawdbot starts a WebSocket server, and Napcat connects to it.

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


- Replace `YOUR_NAPCAT_TOKEN` with the token from your Clawdbot config
- Napcat will connect to Clawdbot automatically on startup
- Messages from allowed QQ numbers are forwarded to Clawdbot for AI processing

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
   clawdbot channels status --probe
   ```

2. Verify Napcat `config.yml` has correct WebSocket URL and token
3. Check Clawdbot logs for connection errors:
   ```bash
   tail -f ~/.clawdbot/gateway.log | grep "QQ Gateway"
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
