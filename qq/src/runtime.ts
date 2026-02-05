// @ts-nocheck
import type { OpenClawRuntime } from "openclaw/plugin-sdk";

let runtime: OpenClawRuntime | null = null;

export function setQQRuntime(next: OpenClawRuntime) {
  runtime = next;
}

export function getQQRuntime(): OpenClawRuntime {
  if (!runtime) {
    throw new Error("QQ runtime not initialized");
  }
  return runtime;
}