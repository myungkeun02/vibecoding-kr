import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { dataDir, production } from './config';
import { id } from './security';
export async function sendMail(to: string, subject: string, text: string) {
  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    });
    if (!r.ok) throw new Error('MAIL_DELIVERY_FAILED');
    return 'sent';
  }
  if (process.env.SMTP_URL && process.env.MAIL_FROM) {
    await nodemailer
      .createTransport(process.env.SMTP_URL)
      .sendMail({ from: process.env.MAIL_FROM, to, subject, text });
    return 'sent';
  }
  if (production) throw new Error('MAIL_NOT_CONFIGURED');
  mkdirSync(join(dataDir, 'outbox'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dataDir, 'outbox', id() + '.json'), JSON.stringify({ to, subject, text }), {
    mode: 0o600,
  });
  return 'local';
}
export const mailAvailable = () =>
  !production || Boolean(process.env.MAIL_FROM && (process.env.SMTP_URL || process.env.RESEND_API_KEY));
