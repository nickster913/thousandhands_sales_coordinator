import type { Response } from "express";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
*{box-sizing:border-box}
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f5f6f8;color:#1d2330}
header{background:#1d2330;color:#fff;padding:12px 24px;display:flex;gap:20px;align-items:center}
header a{color:#cfd6e4;text-decoration:none}header a:hover{color:#fff}
header form{margin:0}header .brand{font-weight:600;color:#fff;margin-right:auto}
main{max-width:960px;margin:24px auto;padding:0 16px}
.card{background:#fff;border:1px solid #e1e4ea;border-radius:8px;padding:16px 20px;margin-bottom:16px}
h1{font-size:22px;margin:0 0 16px}h2{font-size:17px;margin:0 0 12px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #eef0f3;vertical-align:top}
th{font-weight:600;color:#566074;width:220px}
button,.btn{background:#1f6feb;color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button:disabled{background:#a9b4c6;cursor:not-allowed}
button.secondary{background:#e8ebf0;color:#1d2330}button.danger{background:#c93c37}
input[type=password],input[type=text]{font:inherit;padding:8px 10px;border:1px solid #c9ced8;border-radius:6px;width:100%}
.alert{padding:10px 14px;border-radius:6px;margin-bottom:16px}
.alert.error{background:#fdecea;color:#8a1f1a;border:1px solid #f5c2bf}
.alert.warn{background:#fff6e0;color:#7a5200;border:1px solid #f2d68a}
.alert.ok{background:#e7f6ec;color:#1a6b34;border:1px solid #b6e2c4}
.muted{color:#6b7488}.mono{font-family:ui-monospace,Consolas,monospace;font-size:13px}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;background:#e8ebf0}
.badge.ok{background:#d7f1e0;color:#1a6b34}.badge.warn{background:#fff0c7;color:#7a5200}.badge.err{background:#fbd9d6;color:#8a1f1a}
.login{max-width:360px;margin:80px auto}
`;

export function renderPage(
  res: Response,
  opts: { title: string; body: string; nav?: boolean; scripts?: string; status?: number },
) {
  const nonce = res.locals.cspNonce as string;
  const nav = opts.nav === false
    ? ""
    : `<header><span class="brand">Thousand Hands · WhatsApp</span>
        <a href="/admin/whatsapp-connect">Connect</a>
        <a href="/admin/chats">Chats</a>
        <form method="post" action="/admin/logout"><button class="secondary" type="submit">Log out</button></form>
      </header>`;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(opts.title)}</title>
<style nonce="${nonce}">${CSS}</style>
</head><body>
${nav}
<main>${opts.body}</main>
${opts.scripts ?? ""}
</body></html>`;
  res.status(opts.status ?? 200).type("html").set("Cache-Control", "no-store").send(html);
}
