import { Router } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { completeOnboarding, handleSessionEvent, onboardWithCode, sessionEventSchema } from "./onboarding";
import { startSync } from "./sync";

export const onboardingRouter = Router();

const idParam = z.string().regex(/^\d{1,30}$/).optional();
const onboardSchema = z.object({
  code: z.string().min(10).max(4096),
  waba_id: idParam,
  phone_number_id: idParam,
  business_id: idParam,
});

onboardingRouter.post("/api/whatsapp/session-event", async (req, res) => {
  const parsed = sessionEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid session event" });
  await handleSessionEvent(parsed.data);
  res.json({ ok: true });
});

onboardingRouter.post("/api/whatsapp/onboard", async (req, res) => {
  const parsed = onboardSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("Invalid onboard request", { issues: parsed.error.issues.map((i) => i.path.join(".")) });
    return res.status(400).json({ ok: false, error: "invalid request" });
  }
  const { code, waba_id, phone_number_id, business_id } = parsed.data;
  const result = await onboardWithCode({ code, wabaId: waba_id, phoneNumberId: phone_number_id, businessId: business_id });
  res.status(result.ok ? 200 : 502).json(result);
});

onboardingRouter.post("/api/whatsapp/onboard/retry", async (_req, res) => {
  const result = await completeOnboarding({ waitForWabaMs: 0 });
  res.status(result.ok ? 200 : 502).json(result);
});

onboardingRouter.post("/api/whatsapp/sync/:kind", async (req, res) => {
  const kind = req.params.kind;
  if (kind !== "contacts" && kind !== "history") return res.status(404).json({ ok: false, error: "unknown sync" });
  const result = await startSync(kind);
  const status = result.ok ? 200 : result.reason === "failed" ? 502 : 409;
  res.status(status).json(result);
});
