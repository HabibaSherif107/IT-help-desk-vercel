// api/_email.js — sends the help desk's emails (not an endpoint).
// Uses its own SMTP mailbox (SMTP_* settings) and logs every send to email_log.
const nodemailer = require("nodemailer");
const { supabase } = require("./_db");

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || "465", 10);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.zoho.com", port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Arabic part and English part of a bilingual body are separated by this line.
const SEP = "\n\n──────────────\n\n";

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function emailHtml({ headline, body, link, linkLabel }) {
  const color = "#E11A22";
  const parts = String(body).split(SEP.trim());
  const block = (txt, dir) => `<pre dir="${dir}" style="font-family:${dir === "rtl" ? "Tahoma,Arial" : "Inter,Arial"},sans-serif;white-space:pre-wrap;color:#C9C6C4;line-height:1.8;margin:0;text-align:${dir === "rtl" ? "right" : "left"};">${esc(txt.trim())}</pre>`;
  const inner = parts.length === 2
    ? block(parts[0], "rtl") + `<hr style="border:none;border-top:1px solid #2A2626;margin:18px 0;">` + block(parts[1], "ltr")
    : block(body, "ltr");
  const button = link
    ? `<div style="margin-top:22px;"><a href="${esc(link)}" style="display:inline-block;background:${color};color:#fff;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${esc(linkLabel || "Open / فتح")}</a></div>`
    : "";
  return `<div style="max-width:600px;margin:0 auto;background:#12100F;color:#EDE9E6;border-radius:14px;overflow:hidden;border:1px solid #2A2626;"><div style="background:${color};padding:20px 28px;"><span style="font-size:18px;font-weight:800;color:#fff;">${esc(headline)}</span></div><div style="padding:26px 28px;">${inner}${button}</div></div>`;
}

// Never throws: a failed email must not fail the user's action.
async function sendEmail({ to, subject, headline, body, link, linkLabel, kind, ticketId }) {
  if (!to) return false;
  let ok = true;
  try {
    await getTransporter().sendMail({
      from: `"${process.env.MAIL_FROM_NAME || "IT Help Desk"}" <${process.env.SMTP_USER}>`,
      to, subject, text: body,
      html: emailHtml({ headline: headline || subject, body, link, linkLabel }),
    });
  } catch (err) {
    ok = false;
    console.error("Email failed:", to, err.message);
  }
  try {
    await supabase.from("email_log").insert({ recipient: to, kind: kind || "other", ticket_id: ticketId || null, subject, ok });
  } catch (_) { /* logging is best-effort */ }
  return ok;
}

module.exports = { sendEmail, emailHtml, SEP };
