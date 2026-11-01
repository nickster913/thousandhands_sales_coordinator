import { Router } from "express";
import { env } from "../config/env";
import { getAccount } from "../whatsapp/account";
import { renderPage } from "./layout";
import { renderStatusCard } from "./statusCard";

export const connectPageRouter = Router();

/**
 * Embedded Signup v5 extras (current as of Oct 20, 2026).
 * Coexistence (WhatsApp Business app onboarding) is on by default; featureType is not used.
 * See developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5
 */
export const LOGIN_EXTRAS = { version: "v5" };

/** Browser-side script. Only non-secret values (app ID, config ID, Graph version) reach the page. */
const CLIENT_JS = String.raw`
(function () {
  var cfg = JSON.parse(document.getElementById("fb-config").textContent);
  var btn = document.getElementById("connect-btn");
  var msg = document.getElementById("connect-msg");
  var statusEl = document.getElementById("status");
  var latestSession = null;
  var onboarding = false;
  var timer = null;

  function show(kind, text) { msg.className = "alert " + kind; msg.textContent = text; msg.hidden = false; }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }

  function isFacebookOrigin(origin) {
    try {
      var u = new URL(origin);
      return u.protocol === "https:" && (u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"));
    } catch (e) { return false; }
  }

  window.fbAsyncInit = function () {
    FB.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: true, version: cfg.graphVersion });
    btn.disabled = false;
  };

  window.addEventListener("message", function (event) {
    if (!isFacebookOrigin(event.origin)) return;
    var data;
    try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch (e) { return; }
    if (!data || data.type !== "WA_EMBEDDED_SIGNUP") return;
    latestSession = data;
    post("/api/whatsapp/session-event", data).then(refreshStatus);
    var d = data.data || {};
    if (data.event === "CANCEL") show("warn", "Signup cancelled at step: " + (d.current_step || "unknown"));
    else if (data.event === "ERROR") show("error", "Signup error: " + (d.error_message || "unknown") + " (code " + (d.error_code || "?") + ")");
  });

  // FB.login rejects async callbacks, so this must be a plain function.
  function onLogin(response) {
    var code = response && response.authResponse && response.authResponse.code;
    if (!code) { show("warn", "Signup closed without returning a code."); return; }
    var d = (latestSession && latestSession.data) || {};
    onboarding = true;
    show("warn", "Connecting… keep the WhatsApp Business app open on your phone.");
    schedule();
    post("/api/whatsapp/onboard", {
      code: code,
      waba_id: d.waba_id || (d.messaging_account_ids || [])[0],
      phone_number_id: d.phone_number_id,
      business_id: d.business_id
    }).then(function (r) {
      onboarding = false;
      if (r.ok) show("ok", "Connected. Contacts and history sync requested.");
      else show("error", "Onboarding failed at " + (r.step || "?") + ": " + (r.error || ("HTTP " + r._status)));
      refreshStatus();
    }).catch(function (e) { onboarding = false; show("error", "Network error: " + e.message); });
  }

  btn.addEventListener("click", function () {
    FB.login(onLogin, {
      config_id: cfg.configId,
      response_type: "code",
      override_default_response_type: true,
      extras: cfg.extras
    });
  });

  function refreshStatus() {
    fetch("/admin/connect/status", { credentials: "same-origin" })
      .then(function (r) {
        if (r.redirected) { location.reload(); throw new Error("session expired"); }
        if (r.status !== 200) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (html) { statusEl.innerHTML = html; schedule(); })
      .catch(function () { schedule(); });
  }

  function schedule() {
    clearTimeout(timer);
    var card = statusEl.querySelector("[data-poll]");
    if (onboarding || (card && card.getAttribute("data-poll") === "1")) timer = setTimeout(refreshStatus, 4000);
  }

  statusEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-action]");
    if (!b) return;
    b.disabled = true;
    var a = b.getAttribute("data-action");
    var url = a === "retry" ? "/api/whatsapp/onboard/retry" : "/api/whatsapp/sync/" + a;
    post(url).then(function (r) {
      if (!r.ok) show("error", r.error || r.reason || ("HTTP " + r._status));
      refreshStatus();
    });
  });

  schedule();
})();
`;

/** JSON for a <script type="application/json"> block; `<` is escaped so it can't close the tag. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

connectPageRouter.get("/admin/connect", async (_req, res) => {
  const account = await getAccount();
  const nonce = res.locals.cspNonce as string;
  const config = {
    appId: env.META_APP_ID,
    configId: env.META_CONFIG_ID,
    graphVersion: env.META_GRAPH_VERSION,
    extras: LOGIN_EXTRAS,
  };
  renderPage(res, {
    title: "Connect WhatsApp",
    body: `<h1>Connect WhatsApp (coexistence)</h1>
<div class="card">
  <p>Connects the WhatsApp Business app number to Cloud API through Embedded Signup. The number stays on your phone.
  Keep the WhatsApp Business app open during signup and while the sync runs.</p>
  <button type="button" id="connect-btn" class="btn-connect" disabled>Connect WhatsApp</button>
</div>
<div id="connect-msg" class="alert" hidden></div>
<div id="status">${renderStatusCard(account)}</div>`,
    scripts: `<script nonce="${nonce}" id="fb-config" type="application/json">${jsonForScript(config)}</script>
<script nonce="${nonce}">${CLIENT_JS}</script>
<script nonce="${nonce}" async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>`,
  });
});

connectPageRouter.get("/admin/connect/status", async (_req, res) => {
  const account = await getAccount();
  res.type("html").set("Cache-Control", "no-store").send(renderStatusCard(account));
});
