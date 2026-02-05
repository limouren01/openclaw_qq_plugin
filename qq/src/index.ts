// @ts-nocheck
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { qqPlugin } from "./channel.js";
import { setQQRuntime } from "./runtime.js";

const plugin = {
  id: "qq",
  name: "QQ",
  description: "QQ channel plugin via Napcat",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setQQRuntime(api.runtime);
    api.registerChannel({ plugin: qqPlugin });
  },
};

export default plugin;