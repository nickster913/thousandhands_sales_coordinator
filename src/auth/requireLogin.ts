import type { NextFunction, Request, Response } from "express";
import { hasValidSession } from "./session";

/** Redirects browsers to the login page. Use for /admin/* HTML pages. */
export function requireLoginPage(req: Request, res: Response, next: NextFunction) {
  if (hasValidSession(req)) return next();
  const nextUrl = req.method === "GET" ? `?next=${encodeURIComponent(req.originalUrl)}` : "";
  res.redirect(303, `/admin/login${nextUrl}`);
}

/** Returns 401 JSON. Use for /api/whatsapp/* endpoints. */
export function requireLoginApi(req: Request, res: Response, next: NextFunction) {
  if (hasValidSession(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}
