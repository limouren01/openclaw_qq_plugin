// @ts-nocheck
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { qqPlugin } from "./channel.js";
import { setQQRuntime } from "./runtime.js";

const plugin = {
  id: "qq",
  name: "QQ",
  description: "QQ channel plugin via Napcat",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setQQRuntime(api.runtime);
    api.registerChannel({ plugin: qqPlugin });
  },
};

export default plugin;