import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { DmPolicy } from "openclaw/plugin-sdk";
import type { WizardPrompter } from "openclaw/plugin-sdk";
import type { ChannelOnboardingAdapter, ChannelOnboardingDmPolicy } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import {
  listQQAccountIds,
  resolveDefaultQQAccountId,
  resolveQQAccount,
} from "./config.js";
import { addWildcardAllowFrom, promptAccountId } from "openclaw/plugin-sdk";

const channel = "qq" as const;

function setQQDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy, accountId?: string) {
  // 如果提供了 accountId，则在账号级别设置策略
  if (accountId) {
    const allowFrom =
      dmPolicy === "open" ? ["*"] : cfg.channels?.qq?.accounts?.[accountId]?.allowFrom;
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        qq: {
          ...cfg.channels?.qq,
          accounts: {
            ...cfg.channels?.qq?.accounts,
            [accountId]: {
              ...cfg.channels?.qq?.accounts?.[accountId],
              dmPolicy,
              ...(allowFrom ? { allowFrom } : {}),
            },
          },
        },
      },
    };
  }

  // 否则在顶层设置（用于向后兼容）
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.qq?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      qq: {
        ...cfg.channels?.qq,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

async function noteQQTokenHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Open Napcat and navigate to Settings → Websocket Config",
      "2) Find 'Access Token' and copy it",
      "3) The token is used for authentication between OpenClaw and Napcat",
      "4) Make sure Napcat is configured to connect to OpenClaw's WebSocket server",
      "   Reverse WebSocket URL: ws://127.0.0.1:8082",
      "   Authorization header: Bearer YOUR_TOKEN",
      "   X-Self-Id header: your bot QQ number",
      "Docs: See extensions/qq/README.md for detailed setup instructions",
    ].join("\n"),
    "QQ/Napcat token",
  );
}

async function noteQQUserIdHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Find your QQ number in the Napcat UI or QQ client",
      "2) The QQ number is your unique identifier on the QQ platform",
      "3) You can see it in your QQ profile or settings",
      "4) Example: 1234567890",
      "Docs: See extensions/qq/README.md for detailed setup instructions",
    ].join("\n"),
    "QQ user id",
  );
}

function validateQQNumber(value: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "Required";
  }
  if (!/^\d+$/.test(trimmed)) {
    return "QQ number must be numeric only";
  }
  if (trimmed.length < 5 || trimmed.length > 11) {
    return "QQ number should be between 5 and 11 digits";
  }
  return undefined;
}

async function promptQQAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<OpenClawConfig> {
  const { cfg, prompter, accountId } = params;
  const resolved = resolveQQAccount({ cfg, accountId });
  const existingAllowFrom = resolved.config.allowFrom ?? [];
  await noteQQUserIdHelp(prompter);

  const parseInput = (value: string) =>
    value
      .split(/[\n,;]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);

  let resolvedIds: string[] = [];
  while (resolvedIds.length === 0) {
    const entry = await prompter.text({
      message: "QQ allowFrom (QQ numbers)",
      placeholder: "1234567890",
      initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    });
    const parts = parseInput(String(entry));

    // 验证QQ号格式（纯数字）
    const validIds = parts.filter((part) => /^\d+$/.test(part));
    if (validIds.length !== parts.length) {
      await prompter.note(
        `Invalid QQ numbers: ${parts.filter((p) => !/^\d+$/.test(p)).join(", ")}. Use numeric QQ IDs only.`,
        "QQ allowlist",
      );
      continue;
    }

    resolvedIds = validIds;
  }

  const merged = [
    ...existingAllowFrom.map((item) => String(item).trim()).filter(Boolean),
    ...resolvedIds,
  ];
  const unique = [...new Set(merged)];

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      qq: {
        ...cfg.channels?.qq,
        enabled: true,
        accounts: {
          ...cfg.channels?.qq?.accounts,
          [accountId]: {
            ...cfg.channels?.qq?.accounts?.[accountId],
            enabled: cfg.channels?.qq?.accounts?.[accountId]?.enabled ?? true,
            dmPolicy: "allowlist",
            allowFrom: unique,
          },
        },
      },
    },
  };
}

async function promptQQAllowFromForAccount(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<OpenClawConfig> {
  const accountId =
    params.accountId && normalizeAccountId(params.accountId)
      ? (normalizeAccountId(params.accountId) ?? DEFAULT_ACCOUNT_ID)
      : resolveDefaultQQAccountId(params.cfg);
  return promptQQAllowFrom({
    cfg: params.cfg,
    prompter: params.prompter,
    accountId,
  });
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "QQ",
  channel,
  policyKey: "channels.qq.dmPolicy",
  allowFromKey: "channels.qq.allowFrom",
  getCurrent: (cfg) => cfg.channels?.qq?.dmPolicy ?? "allowlist",
  setPolicy: (cfg, policy) => setQQDmPolicy(cfg, policy),
  promptAllowFrom: promptQQAllowFromForAccount,
};

export const qqOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = listQQAccountIds(cfg).some((accountId) =>
      Boolean(resolveQQAccount({ cfg, accountId }).token),
    );
    return {
      channel,
      configured,
      statusLines: [`QQ: ${configured ? "configured" : "needs token"}`],
      selectionHint: configured ? "configured" : "needs token",
      quickstartScore: configured ? 3 : 2,
    };
  },
  configure: async ({
    cfg,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
    forceAllowFrom,
  }) => {
    const qqOverride = accountOverrides.qq?.trim();
    const defaultQQAccountId = resolveDefaultQQAccountId(cfg);
    let qqAccountId = qqOverride
      ? normalizeAccountId(qqOverride)
      : defaultQQAccountId;

    // 如果没有通过参数指定QQ号，且当前是默认账号或没有已配置的账号，则提示输入
    const shouldPromptForQQId = !qqOverride && (
      shouldPromptAccountIds ||
      qqAccountId === DEFAULT_ACCOUNT_ID ||
      !listQQAccountIds(cfg).some(id => id !== DEFAULT_ACCOUNT_ID)
    );

    if (shouldPromptForQQId) {
      await prompter.note(
        [
          "Please enter your bot's QQ number.",
          "This is the QQ number where Napcat is running.",
          "Example: 1234567890",
        ].join("\n"),
        "Bot QQ Number"
      );

      // 提示输入QQ号并验证格式
      let qqIdValid = false;
      while (!qqIdValid) {
        const inputQQId = await prompter.text({
          message: "Enter your bot's QQ number",
          placeholder: "1234567890",
          validate: validateQQNumber,
        });
        qqAccountId = String(inputQQId).trim();
        qqIdValid = true;
      }

      // 标准化账号ID
      qqAccountId = normalizeAccountId(qqAccountId) ?? qqAccountId;
    }

    let next = cfg;
    const resolvedAccount = resolveQQAccount({
      cfg: next,
      accountId: qqAccountId,
    });
    const accountConfigured = Boolean(resolvedAccount.token);
    const hasConfigToken = Boolean(resolvedAccount.config.token);

    let token: string | null = null;
    if (!accountConfigured) {
      await noteQQTokenHelp(prompter);
    }
    if (hasConfigToken) {
      const keep = await prompter.confirm({
        message: "QQ token already configured. Keep it?",
        initialValue: true,
      });
      if (!keep) {
        token = String(
          await prompter.text({
            message: "Enter QQ (Napcat) token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else {
      token = String(
        await prompter.text({
          message: "Enter QQ (Napcat) token",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    // 提示输入绑定地址和端口
    if (token) {
      const existingBindHost = resolvedAccount.config.bindHost ?? "127.0.0.1";
      const existingBindPort = resolvedAccount.config.bindPort ?? 8082;

      const bindHost = await prompter.text({
        message: "WebSocket bind host (Napcat connects to this)",
        initialValue: existingBindHost,
        validate: (value) => (value?.trim() ? undefined : "Required"),
      });

      const bindPort = await prompter.text({
        message: "WebSocket bind port",
        initialValue: String(existingBindPort),
        validate: (value) => {
          const port = Number(value?.trim());
          return port > 0 && port < 65536 ? undefined : "Invalid port (1-65535)";
        },
      });

      next = {
        ...next,
        channels: {
          ...next.channels,
          qq: {
            ...next.channels?.qq,
            enabled: true,
            accounts: {
              ...next.channels?.qq?.accounts,
              [qqAccountId]: {
                ...next.channels?.qq?.accounts?.[qqAccountId],
                enabled: next.channels?.qq?.accounts?.[qqAccountId]?.enabled ?? true,
                token: String(token),
                bindHost: String(bindHost),
                bindPort: Number(bindPort),
              },
            },
          },
        },
      };
    }

    // 询问是否设置DM策略和allowFrom
    const setupDmPolicy = await prompter.confirm({
      message: "Set up DM access control (allowlist)?",
      initialValue: true,
    });

    if (setupDmPolicy) {
      if (forceAllowFrom) {
        next = await promptQQAllowFrom({
          cfg: next,
          prompter,
          accountId: qqAccountId,
        });
      } else {
        // 即使没有强制要求，也询问是否设置allowFrom
        const setupAllowFrom = await prompter.confirm({
          message: "Configure allowFrom (QQ numbers that can DM the bot)?",
          initialValue: false,
        });
        if (setupAllowFrom) {
          next = await promptQQAllowFrom({
            cfg: next,
            prompter,
            accountId: qqAccountId,
          });
        } else {
          // 设置为开放策略（在账号级别）
          next = setQQDmPolicy(next, "open", qqAccountId);
        }
      }
    }

    return { cfg: next, accountId: qqAccountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      qq: { ...cfg.channels?.qq, enabled: false },
    },
  }),
};
