import type { Request, Response } from "express";

const webtaskTools = require("webtask-tools") as {
  fromExpress: (app: (req: Request, res: Response) => void) => (
    context: WebtaskContext,
    req: Request,
    res: Response,
  ) => void;
};

type CreateExtensionApp = typeof import("./app").createExtensionApp;

interface WebtaskContext {
  data?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  [key: string]: unknown;
}

interface WebtaskRequest extends Request {
  webtaskContext?: WebtaskContext;
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

export const handler = webtaskTools.fromExpress((req: Request, res: Response) => {
  const context = (req as WebtaskRequest).webtaskContext ?? {};
  const createExtensionApp = loadCreateExtensionApp();
  const app = createExtensionApp((key) => readContextValue(context, key), req);
  app(req, res);
});
