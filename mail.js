// Outgoing email via Brevo SMTP. Switched on only when BREVO_SMTP_LOGIN, BREVO_SMTP_KEY and MAIL_FROM are set.
// Used for quote alerts to operators. Never throws: a failed email is logged and the quote is still saved.
const nodemailer = require('nodemailer');

const LOGIN = process.env.BREVO_SMTP_LOGIN || '', KEY = process.env.BREVO_SMTP_KEY || '', FROM = process.env.MAIL_FROM || '';
const TEST = process.env.MAIL_TEST === '1'; // local testing: build the message but send nothing
const ON = TEST || !!(LOGIN && KEY && FROM);
let transport = null;
function tr() {
  if (!transport) transport = TEST ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ host: 'smtp-relay.brevo.com', port: 587, secure: false, requireTLS: true,
    auth: { user: LOGIN, pass: KEY }, connectionTimeout: 15000, socketTimeout: 20000 });
  return transport;
}

async function send({ to, cc, subject, text, html, attachments, replyTo }) {
  if (!ON) return { ok: false, skipped: true };
  try {
    const info = await tr().sendMail({ from: FROM || 'test@example.com', to, cc: cc || undefined, replyTo: replyTo || undefined, subject, text, html, attachments: attachments || [] });
    if (TEST) console.log('MAIL_TEST', JSON.stringify({ to, cc, subject, attachments: (attachments || []).map(a => a.filename), textStart: text.slice(0, 160) }));
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('Email failed', subject, e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { send, ON };
