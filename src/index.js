/**
 * failloudly.com — intake endpoint
 *
 * Receives a project enquiry from the site's intake form or chat assistant,
 * emails it to Hridoy, and sends the person who submitted it a copy so they
 * have a written record of what they asked for.
 *
 * Requires one secret, set in the Cloudflare dashboard:
 *   RESEND_API_KEY   — from https://resend.com (free tier: 3,000 emails/month)
 *
 * Optional plain variables, with the defaults shown:
 *   OWNER_EMAIL      — hridoy@failloudly.com
 *   FROM_ADDRESS     — Failloudly <intake@send.failloudly.com>
 *
 * Everything that is not /api/intake falls through to the static site.
 */

const DEFAULTS = {
  OWNER_EMAIL: "hridoy@failloudly.com",
  FROM_ADDRESS: "Failloudly <intake@send.failloudly.com>",
};

const LIMITS = { message: 8000, field: 2000, email: 254 };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  // strip control characters but keep newlines and tabs
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- email bodies ---------- */

function ownerEmail({ subject, email, message, source, meta }) {
  const rows = message
    .split("\n\n")
    .map((block) => escapeHtml(block).replace(/\n/g, "<br>"))
    .join("</p><p style=\"margin:0 0 14px\">");

  return {
    subject: `[failloudly] ${subject}`,
    text: `${message}\n\n---\nReply to: ${email}\nSource: ${source}\n${meta}`,
    html: `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;line-height:1.7;color:#12171C">
<p style="margin:0 0 14px">${rows}</p>
<hr style="border:0;border-top:1px solid #D8DEE4;margin:20px 0">
<p style="margin:0;color:#5C6771;font-size:12px">
Reply to: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br>
Source: ${escapeHtml(source)}<br>${escapeHtml(meta)}
</p></div>`,
  };
}

function senderCopy({ message, ownerEmail: owner }) {
  const blocks = message
    .split("\n\n")
    .map((block) => escapeHtml(block).replace(/\n/g, "<br>"))
    .join("</p><p style=\"margin:0 0 12px\">");

  const text = [
    "Thanks for getting in touch.",
    "",
    "Hridoy has your enquiry and will reply within one working day with a scope and a fixed price. Here is what you sent, so you have it in writing:",
    "",
    message,
    "",
    "If anything above is wrong, just reply to this email and it reaches him directly.",
    "",
    "— failloudly.com",
    "Integration & automation engineering",
  ].join("\n");

  return {
    subject: "Your enquiry — failloudly.com",
    text,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.65;color:#12171C;max-width:560px">
<p style="margin:0 0 16px">Thanks for getting in touch.</p>
<p style="margin:0 0 16px">Hridoy has your enquiry and will reply within one working day with a scope and a fixed price. Here is what you sent, so you have it in writing:</p>
<div style="background:#F4F6F8;border-left:3px solid #E8913A;padding:16px 18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.7">
<p style="margin:0 0 12px">${blocks}</p>
</div>
<p style="margin:16px 0 0">If anything above is wrong, just reply to this email — it reaches him directly at ${escapeHtml(owner)}.</p>
<p style="margin:24px 0 0;color:#5C6771;font-size:12px">
<b style="color:#12171C">failloudly.com</b><br>Integration &amp; automation engineering
</p></div>`,
  };
}

/* ---------- send ---------- */

async function sendMail(apiKey, payload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/* ---------- handler ---------- */

async function handleIntake(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ error: "mail is not configured yet" }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  // Honeypot: real visitors never fill this, bots usually do.
  if (clean(body._hp, 100)) return json({ ok: true });

  const email = clean(body.email, LIMITS.email);
  const message = clean(body.message, LIMITS.message);
  const subject = clean(body.subject, 160) || "New project enquiry";
  const source = clean(body.source, 60) || "website";

  if (!validEmail(email)) return json({ error: "a valid email is required" }, 400);
  if (message.length < 20) return json({ error: "message is too short" }, 400);

  const owner = env.OWNER_EMAIL || DEFAULTS.OWNER_EMAIL;
  const from = env.FROM_ADDRESS || DEFAULTS.FROM_ADDRESS;
  const meta = [
    `Country: ${request.headers.get("cf-ipcountry") || "unknown"}`,
    `Received: ${new Date().toISOString()}`,
  ].join("\n");

  const toOwner = ownerEmail({ subject, email, message, source, meta });
  const toSender = senderCopy({ message, ownerEmail: owner });

  try {
    // The enquiry itself — replying to it goes straight to the sender.
    await sendMail(apiKey, {
      from,
      to: [owner],
      reply_to: email,
      subject: toOwner.subject,
      text: toOwner.text,
      html: toOwner.html,
    });
  } catch (err) {
    console.error("owner email failed", err);
    return json({ error: "could not send" }, 502);
  }

  try {
    // The sender's copy — replying to it reaches Hridoy.
    await sendMail(apiKey, {
      from,
      to: [email],
      reply_to: owner,
      subject: toSender.subject,
      text: toSender.text,
      html: toSender.html,
    });
  } catch (err) {
    // The enquiry is already delivered; a failed courtesy copy is not a failure.
    console.error("sender copy failed", err);
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/intake") return handleIntake(request, env);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  },
};
