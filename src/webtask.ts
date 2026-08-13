import type { Request, Response } from "express";

type CreateExtensionApp = typeof import("./app").createExtensionApp;
type ExtensionApp = ReturnType<CreateExtensionApp>;

interface WebtaskContext {
  data?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  [key: string]: unknown;
}

function loadCreateExtensionApp(): CreateExtensionApp {
  return (require("./app") as { createExtensionApp: CreateExtensionApp }).createExtensionApp;
}

function readContextValue(context: WebtaskContext, key: string): string | undefined {
  for (const source of [context.data, context.secrets, context]) {
    const value = source?.[key];
    if (typeof value === "string") return value;
  }

  const environmentValue = process.env[key];
  return typeof environmentValue === "string" ? environmentValue : undefined;
}

export const handler = (
  context: WebtaskContext,
  req: Parameters<ExtensionApp>[0],
  res: Parameters<ExtensionApp>[1],
) => {
  const createExtensionApp = loadCreateExtensionApp();
  const app = createExtensionApp((key) => readContextValue(context, key), req as Request);
  app(req, res as Response);
};
