import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { safeEqual } from "../lib/crypto";
import { logger } from "../lib/logger";
import { escapeHtml, renderPage } from "../admin/layout";
import { createSession, destroySession, hasValidSession } from "./session";

export const loginRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    logger.warn("Admin login rate limit hit", { ip: req.ip });
    renderLogin(res, "Too many login attempts. Try again in 15 minutes.", "/admin", 429);
  },
});

/** Only allow redirects back into /admin, to avoid open redirects. */
function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/admin(\/|$|\?)/.test(value) && !value.startsWith("//")
    ? value
    : "/admin/whatsapp-connect";
}

function renderLogin(res: express.Response, error: string | null, next: string, status = 200) {
  renderPage(res, {
    title: "Admin login",
    nav: false,
    status,
    body: `<div class="login card">
      <h1>Admin login</h1>
      ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ""}
      <form method="post" action="/admin/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <p><input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus></p>
        <button type="submit">Log in</button>
      </form>
    </div>`,
  });
}

loginRouter.get("/admin/login", (req, res) => {
  const next = safeNext(req.query.next);
  if (hasValidSession(req)) return res.redirect(303, next);
  renderLogin(res, null, next);
});

loginRouter.post("/admin/login", loginLimiter, express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const next = safeNext(req.body?.next);
  if (!safeEqual(password, env.ADMIN_PASSWORD)) {
    logger.warn("Admin login failed", { ip: req.ip });
    return renderLogin(res, "Incorrect password.", next, 401);
  }
  logger.info("Admin login succeeded", { ip: req.ip });
  createSession(res);
  res.redirect(303, next);
});

loginRouter.post("/admin/logout", (_req, res) => {
  destroySession(res);
  res.redirect(303, "/admin/login");
});
