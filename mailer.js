"use strict";
/* Transactional email: verification codes, password resets and account notices.
   Production sends through Resend (https://resend.com) when RESEND_API_KEY is set.
   For local development only, DEV_MAIL=1 keeps messages in an in-memory outbox instead. */
const KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.MAIL_FROM || "Hinova Marketplace <no-reply@hinovaiq.io>";
const REPLY_TO = process.env.MAIL_REPLY_TO || "support@hinovaiq.io";
const DEV = process.env.NODE_ENV !== "production" && process.env.DEV_MAIL === "1";
const outbox = [];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// One simple, branded layout for every message
function layout({ heading, intro, code, button, after }) {
  const html = `<!doctype html><html><body style="margin:0;background:#F7F6FB;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16171D">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;padding:32px">
    <tr><td style="font-weight:800;font-size:18px;color:#0F5C3F">Hinova Marketplace</td></tr>
    <tr><td style="padding-top:20px;font-size:22px;font-weight:700">${esc(heading)}</td></tr>
    <tr><td style="padding-top:12px;font-size:15px;line-height:1.55;color:#3D3F4A">${esc(intro)}</td></tr>
    ${code ? `<tr><td style="padding-top:20px"><div style="font-family:Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:700;background:#EEF6F1;border-radius:12px;padding:16px 20px;text-align:center">${esc(code)}</div></td></tr>` : ""}
    ${button ? `<tr><td style="padding-top:20px"><a href="${esc(button.href)}" style="display:inline-block;background:#0F5C3F;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${esc(button.label)}</a></td></tr>` : ""}
    ${after ? `<tr><td style="padding-top:18px;font-size:13px;line-height:1.5;color:#6B6E7A">${esc(after)}</td></tr>` : ""}
    <tr><td style="padding-top:26px;border-top:1px solid #ECEBF2;margin-top:20px;font-size:12px;color:#8A8D99">Hinova Marketplace is a product of Hinovaiq · support@hinovaiq.io<br>You're getting this because of activity on your Hinova Marketplace account.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = [heading, "", intro, code ? `\n    ${code}\n` : "", button ? `${button.label}: ${button.href}` : "", after ? `\n${after}` : "",
    "\n--\nHinova Marketplace, a product of Hinovaiq · support@hinovaiq.io"].filter((x) => x !== "").join("\n");
  return { html, text };
}

async function send(to, subject, parts) {
  const { html, text } = layout(parts);
  if (KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text, reply_to: REPLY_TO }),
    });
    if (!r.ok) throw new Error(`Resend responded ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return;
  }
  if (DEV) {
    outbox.push({ to, subject, text, at: Date.now() });
    if (outbox.length > 300) outbox.shift();
    console.log(`[dev mail] to=${to} subject="${subject}"`);
    return;
  }
  throw new Error("Email delivery is not configured (set RESEND_API_KEY).");
}

module.exports = {
  enabled: !!KEY || DEV,
  provider: KEY ? "resend" : DEV ? "dev" : "none",
  outbox,
  send,
  verifyCode: (to, name, code, link) => send(to, `${code} is your Hinova Marketplace code`, {
    heading: "Confirm your email",
    intro: `Hi ${name || "there"}, enter this code in Hinova Marketplace to verify your email address. It expires in 30 minutes.`,
    code, button: { label: "Or verify with one tap", href: link },
    after: "If you didn't create an account, you can ignore this email. Nobody can use your address without this code.",
  }),
  resetLink: (to, name, link) => send(to, "Reset your Hinova Marketplace password", {
    heading: "Reset your password",
    intro: `Hi ${name || "there"}, we got a request to reset the password for this account. The link works once and expires in 30 minutes.`,
    button: { label: "Choose a new password", href: link },
    after: "If you didn't ask for this, ignore this email. Your password stays the same.",
  }),
  notice: (to, name, heading, intro) => send(to, heading, {
    heading, intro: `Hi ${name || "there"}, ${intro}`,
    after: "If this wasn't you, reset your password right away and contact support@hinovaiq.io.",
  }),
};
