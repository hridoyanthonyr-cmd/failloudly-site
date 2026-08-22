/**
 * failloudly.com — mail relay
 *
 * Deployed as a Google Apps Script web app, this receives enquiries from the
 * site and sends two emails from your own Workspace mailbox:
 *   1. the enquiry to you, with reply-to set to the sender
 *   2. a confirmation copy to the sender, with reply-to set to you
 *
 * No API keys, no DNS records, no third-party service.
 *
 * SETUP
 *   1. script.google.com → New project → paste this file over Code.gs
 *   2. Change SHARED_SECRET below to any random string you like
 *   3. Deploy → New deployment → type "Web app"
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      (Anyone means anyone can POST to the URL — the shared secret is what
 *       stops strangers sending mail as you, so do not skip step 2.)
 *   4. Copy the /exec URL it gives you
 *   5. Cloudflare → Workers & Pages → failloudly-site → Settings →
 *      Variables and Secrets:
 *        MAIL_RELAY_URL   (Secret)  = the /exec URL
 *        RELAY_SECRET     (Secret)  = the same string as SHARED_SECRET
 *   6. Deploy. Check failloudly.com/api/intake — it should report
 *      "transport": "relay".
 *
 * Sending limits: Google Workspace allows 1,500 recipients a day, which is far
 * more than this will ever use.
 */

var SHARED_SECRET = "change-me-to-something-random";
var OWNER = "hridoy@failloudly.com";
var OWNER_NAME = "Hridoy Rozario";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return reply({ error: "empty request" });

    var body = JSON.parse(e.postData.contents);

    if (body.secret !== SHARED_SECRET) return reply({ error: "unauthorized" });

    var email = String(body.email || "").trim();
    var message = String(body.message || "").trim();
    var subject = String(body.subject || "New project enquiry").trim().slice(0, 160);
    var source = String(body.source || "website").trim().slice(0, 60);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply({ error: "invalid email" });
    if (message.length < 20) return reply({ error: "message too short" });
    if (message.length > 8000) message = message.slice(0, 8000);

    // 1. The enquiry, to you. Hitting reply goes straight to them.
    MailApp.sendEmail({
      to: OWNER,
      replyTo: email,
      name: "failloudly.com",
      subject: "[failloudly] " + subject,
      body: message + "\n\n---\nReply to: " + email + "\nSource: " + source,
    });

    // 2. The confirmation copy, to them. Hitting reply goes straight to you.
    MailApp.sendEmail({
      to: email,
      replyTo: OWNER,
      name: OWNER_NAME,
      subject: "Your enquiry — failloudly.com",
      body: confirmation(message),
    });

    return reply({ ok: true });
  } catch (err) {
    return reply({ error: String(err) });
  }
}

function doGet() {
  return reply({ ok: true, service: "failloudly mail relay" });
}

function confirmation(message) {
  return [
    "Thanks for getting in touch.",
    "",
    "I have your enquiry and will reply within one working day with a scope and",
    "a fixed price. Here is what you sent, so you have it in writing:",
    "",
    "----------------------------------------",
    message,
    "----------------------------------------",
    "",
    "If anything above is wrong, just reply to this email and it reaches me",
    "directly.",
    "",
    "— Hridoy Rozario",
    "failloudly.com · integration & automation engineering",
  ].join("\n");
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
