# Thousand Hands Sales Coordinator

This is a Node.js (Express) server that sits between **WhatsApp** and Thousand Hands.

**In one sentence:** a customer texts the shop WhatsApp number, this server asks Claude, and the reply goes back out on WhatsApp.

The shop phone number stays on the phone. The server listens in the background. That setup is called *coexistence*.

---

## What works today

- Password-protected admin at `/admin`
- **Connect WhatsApp** at `/admin/connect` (Facebook Embedded Signup v5)
- Webhook at `/webhook` that Meta can call
- Saving customer messages, contacts, chat history, and replies sent from the phone
- Claude replies to new **text** messages (`ANTHROPIC_API_KEY` / `AI_MODEL`)
- Sending that reply back through Cloud API (`POST /{phone_number_id}/messages`)
- Staying quiet for `TAKEOVER_PAUSE_HOURS` (default 2) after someone replies from the phone app
- A one-shot text fallback when the customer sends a photo or other non-text

## What is not built yet

Still missing: real orders/invoices/catalog, owner notifications (`NOTIFY_WEBHOOK_URL`), an admin chats page (`/admin/chats` 404s), and real content on the Status page. Invoice/GST env vars are still unused. Claude does not know prices or stock — it will say a person will confirm.

---

## Live setup (production)

This is how it is actually wired. Use this when something breaks.

### Accounts (do not mix these up)

Meta requires **two businesses**: a tech provider that owns the app, and a client that owns the phone number. Pointing Embedded Signup at the app-owner business fails.

```
Zolin  (tech provider portfolio)
ID: 1579574943458923
  └─ Meta app "Zolin"   App ID: 1067046739139228
     Mode: Live
     Webhook: https://thousandhandssalescoordinator-production.up.railway.app/webhook
                    │
                    │  Embedded Signup shares the client WABA with this app
                    ▼
Genhub  (client portfolio)     ID: 1579598793400639
  └─ WhatsApp Business Account "Thousand Hands"
     Number: +65 8770 8858
     Mode: coexistence (WhatsApp Business app on the phone + Cloud API webhooks)
```

In the Embedded Signup picker, always choose **Genhub**, never **Zolin**.

### Railway

| | |
|---|---|
| Service | `thousandhands_sales_coordinator` |
| Public URL | `https://thousandhandssalescoordinator-production.up.railway.app` |
| Admin | `https://thousandhandssalescoordinator-production.up.railway.app/admin` |
| Health | `https://thousandhandssalescoordinator-production.up.railway.app/health` → `ok` |
| Database | Railway Postgres on the private network |
| Runtime | Node 22, Express. Railway sets `PORT`. `NODE_ENV=production`. |

On boot the container runs `prisma migrate deploy`, then `node dist/index.js`.

WABA ID, phone number ID, and the business access token are **not** env vars. After a successful Connect they live in the `WhatsappAccount` row (token encrypted as `businessTokenEncrypted`).

### Environment variables that this app actually reads

See `.env.example`. The important production ones:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Railway Postgres, e.g. `${{Postgres.DATABASE_URL}}` |
| `APP_BASE_URL` | Must be exactly `https://thousandhandssalescoordinator-production.up.railway.app` (no trailing slash) |
| `META_APP_ID` | `1067046739139228` |
| `META_APP_SECRET` | App secret. Also used to check `X-Hub-Signature-256` on webhook POSTs |
| `META_CONFIG_ID` | Embedded Signup configuration ID |
| `WEBHOOK_VERIFY_TOKEN` | Same value as Meta’s webhook verify token |
| `ENCRYPTION_KEY` | Encrypts the WhatsApp business token in the DB |
| `ADMIN_PASSWORD` / `SESSION_SECRET` | Admin login |
| `ANTHROPIC_API_KEY` / `AI_MODEL` | Claude. Default model `claude-sonnet-5-5`. |
| `TAKEOVER_PAUSE_HOURS` | Hours the bot stays quiet after a phone-app reply (default 2) |

There is no `WHATSAPP_ACCESS_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` env var. Do not add Python vars (`PYTHONUNBUFFERED`, etc.) — this is not FastAPI.

---

## How a WhatsApp message lands in Postgres

1. Customer texts **+65 8770 8858**.
2. Meta `POST`s `https://…/webhook` with user agent `facebookexternalua`.
3. The server checks `X-Hub-Signature-256` against `META_APP_SECRET`. Bad signature → `401`.
4. The raw payload is stored in `WebhookEvent` (`processed = false`).
5. The server replies `200 ok` immediately (Meta times out if this is slow).
6. A background queue then:
   - writes the chat into `Message` / `Contact` / `ChatState`
   - waits 3 seconds so several messages from the same chat become one reply
   - skips the reply when not connected, AI is off, a phone reply is still inside `TAKEOVER_PAUSE_HOURS`, or the customer's last message is older than 24 hours
   - calls Claude with the last 20 lines, checks those skips again, then sends the text and stores it as `direction = out_bot`

Production logs **never print the message text**. The text is in Postgres (`Message.text`). Claude Cloud API sends do **not** show up as `smb_message_echoes` (those are phone-app sends only).

### Webhook handshake (Meta “verify”)

`GET /webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`

If `hub.verify_token` matches `WEBHOOK_VERIFY_TOKEN`, the server returns the challenge as plain text. That is what Meta’s webhook “Test” / save button uses.

Subscribed fields: `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.

### Where to look when debugging

| Want | Look here |
|---|---|
| Did HTTP reach Railway? | Railway **Network Logs** (proxy only: status, bytes). Useless for message content. |
| Did the app handle it? | Railway **Deploy Logs**. JSON lines. Look for `POST /webhook`, then `Anthropic response`, then `AI reply sent`. |
| Bot stayed quiet | `Skipping AI reply` with `reason`: `not_connected`, `takeover_pause`, `ai_disabled`, `outside_service_window`, `fallback_cooldown`, `newer_messages`. |
| What did they say / what did we send? | Postgres `Message` table (`direction` `in` vs `out_bot`), not the logs. |
| Signature / verify failures | Deploy Logs: `Webhook signature rejected` or `Webhook verification rejected`. |
| Connection / sync state | `/admin/connect` (the Status nav item is still a placeholder). |

---

## Troubleshooting (errors we actually hit)

### `#1690130` Isn't a valid Business ID

Embedded Signup was pointed at **Zolin** (the app owner). A business cannot partner-share with itself.

**Fix:** In the signup selector pick **Genhub**.

### `#2655115` This account type doesn't support partner sharing

Either the number was typed into normal Cloud API registration instead of coexistence onboarding, or it was still attached to an old WABA.

**Fix:** Remove the number from the old WABA in Meta Business Manager. Connect only through `/admin/connect` (Embedded Signup v5, coexistence on by default). Do not register the number in the Cloud API phone box.

### `#2655123` The phone number is already linked to a Facebook Page

The number was the Page’s WhatsApp CTA. Coexistence onboarding is blocked until that is cleared.

**Fix:** Facebook Page (desktop) → Settings → Linked accounts → WhatsApp → Disconnect. Finish Embedded Signup, then you can reconnect the Page button.

### `#100` Register endpoint is not available for SMB businesses

Someone called `POST /{phone_number_id}/register` on a coexistence number.

**Rule:** Do not call `/register`. The phone is registered by Embedded Signup. This codebase already skips that call.

### Webhook “Test” works, real chats do nothing

Usually: the WABA is not subscribed to the app, or the Meta app is still **In development**.

**Fix:** App mode **Live**. After Connect, this app calls `POST /{waba_id}/subscribed_apps` itself. You can confirm in Graph API Explorer with the business token: response should be `{"success":true}`.

### Messages arriving but “invisible” in Railway

You are on **Network Logs**. Switch to **Deploy Logs**. You will see a request line, not the chat text. Query Postgres for the text.

### Connect popup dies or `403 forbidden origin`

`APP_BASE_URL` does not match the URL in the browser (trailing slash, `http` vs `https`, wrong host).

---

## Run it on your computer

You need **Node.js 22+** and **Docker**.

```bash
cp .env.example .env
# fill in .env
npm install
npm run db:up
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin). WhatsApp will not send to `localhost`; use the Railway URL (or a tunnel) as `APP_BASE_URL` and as the Meta webhook.

```bash
npm test
```

---

## Meta app checklist (for a fresh setup)

1. App lives under **Zolin**. Add the WhatsApp product. App mode **Live**.
2. Embedded Signup configuration → `META_CONFIG_ID`.
3. Webhook URL `https://thousandhandssalescoordinator-production.up.railway.app/webhook`, verify token = `WEBHOOK_VERIFY_TOKEN`.
4. Subscribe to `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`.
5. Put the Railway domain in the app’s allowed domains / redirect URLs.
6. On `/admin/connect`, keep the **WhatsApp Business app open on the phone**. Contacts and history can only be synced once, within 24 hours of connecting. Always pick **Genhub** as the business.
