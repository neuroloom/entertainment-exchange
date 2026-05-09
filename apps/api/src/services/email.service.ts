// Email service — real SMTP email sending via nodemailer
// Implements the EmailProvider interface from notification.service.ts
import type { EmailProvider } from './notification.service.js';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  // Dynamic import — nodemailer is ESM-only in v7+
  return import('nodemailer').then(nm =>
    nm.default.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    }),
  ).catch(() => null);
}

let _provider: EmailProvider | null = null;
let _init = false;

export const emailService = {
  async getProvider(): Promise<EmailProvider | null> {
    if (_init) return _provider;
    _init = true;

    const transporter = await getTransporter();
    if (!transporter) {
      // Fallback: log to console when SMTP is not configured
      _provider = {
        async send(to: string, subject: string, htmlBody: string) {
          const from = process.env.SMTP_FROM ?? 'noreply@entex.com';
          console.log(`[email] To: ${to} | Subject: ${subject} | From: ${from}`);
          return { success: true };
        },
      };
      return _provider;
    }

    _provider = {
      async send(to: string, subject: string, htmlBody: string) {
        try {
          const from = process.env.SMTP_FROM ?? 'noreply@entex.com';
          await transporter.sendMail({ from, to, subject, html: htmlBody });
          return { success: true };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : 'Send failed' };
        }
      },
    };
    return _provider;
  },
};
