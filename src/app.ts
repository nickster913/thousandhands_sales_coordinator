import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { logger } from "./lib/logger";
import { loginRouter } from "./auth/loginRoutes";
import { requireLoginApi, requireLoginPage } from "./auth/requireLogin";
import { renderPage } from "./admin/layout";
import { connectPageRouter } from "./admin/connectPage";
import { onboardingRouter } from "./whatsapp/onboardingRoutes";
import { webhookRouter } from "./webhook/routes";
import { env } from "./config/env";

const APP_ORIGIN = new URL(env.APP_BASE_URL).origin;

/** CSRF defence in depth on top of SameSite=Lax: browsers always send Origin on cross-site POSTs. */
function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.get("origin");
  if (origin && origin !== APP_ORIGIN) {
    logger.warn("Rejected cross-origin API request", { path: req.path, origin });
    return res.status(403).json({ ok: false, error: "forbidden origin" });
  }
  next();
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Railway terminates TLS at one edge proxy; trusting exactly one hop makes req.ip/req.secure correct
  // without letting clients spoof X-Forwarded-For.
  app.set("trust proxy", 1);

  app.use((_req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`,
            "https://connect.facebook.net",
            "https://*.facebook.com",
          ],
          styleSrc: ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
          imgSrc: ["'self'", "data:", "https://*.facebook.com", "https://*.fbcdn.net"],
          connectSrc: ["'self'", "https://*.facebook.com", "https://connect.facebook.net"],
          frameSrc: ["https://*.facebook.com"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // FB.login opens a popup that posts messages back; strict COOP would break that.
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    }),
  );

  // Request logging: method, path (no query string, which may carry codes/tokens), status, duration.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info("request", { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
    });
    next();
  });

  // Raw body for /webhook (signature verification needs exact bytes). Must be registered before express.json.
  app.use("/webhook", express.raw({ type: "*/*", limit: "50mb" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // Public: signature-verified (POST) or verify-token handshake (GET). Not behind admin login.
  app.use(webhookRouter);

  app.use(loginRouter);

  app.use("/admin", requireLoginPage);
  app.use("/api/whatsapp", requireLoginApi, sameOriginOnly);

  app.use(connectPageRouter);
  app.use(onboardingRouter);

  app.get("/admin", (_req, res) =>
    renderPage(res, {
      title: "Thousand Hands admin",
      body: `<h1>Status</h1><div class="card muted">Connection and sync status will appear here.</div>`,
    }),
  );

  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number })?.status ?? 500;
    if (status >= 500) logger.error("Unhandled error", { path: req.path, err });
    if (res.headersSent) return;
    res.status(status).type("text/plain").send(status >= 500 ? "Internal error" : "Bad request");
  });

  return app;
}
