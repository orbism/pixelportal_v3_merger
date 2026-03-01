import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, BUG_REPORT_RECIPIENTS } =
    process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !BUG_REPORT_RECIPIENTS) {
    console.error("Missing SMTP env vars");
    return res.status(500).json({ success: false, error: "Server misconfigured" });
  }

  const { name, email, walletAddress, discordUsername, telegramUsername, message } = req.body ?? {};

  if (!name || !message) {
    return res.status(400).json({ success: false, error: "Name and message are required" });
  }

  const contactRows = [
    email && `<tr><td><strong>Email</strong></td><td>${esc(email)}</td></tr>`,
    walletAddress && `<tr><td><strong>Wallet</strong></td><td><code>${esc(walletAddress)}</code></td></tr>`,
    discordUsername && `<tr><td><strong>Discord</strong></td><td>${esc(discordUsername)}</td></tr>`,
    telegramUsername && `<tr><td><strong>Telegram</strong></td><td>${esc(telegramUsername)}</td></tr>`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <h2>Bug Report from ${esc(name)}</h2>
    ${contactRows ? `<table style="border-collapse:collapse;margin-bottom:16px">${contactRows}</table>` : ""}
    <h3>Message</h3>
    <p style="white-space:pre-wrap">${esc(message)}</p>
  `.trim();

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: (Number(SMTP_PORT) || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: BUG_REPORT_RECIPIENTS.split(",").map((e) => e.trim()),
      subject: `[Pixel Portal] Bug Report from ${name}`,
      html,
    });
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("Failed to send bug report email:", err);
    return res.status(500).json({ success: false, error: "Failed to send email" });
  }
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
