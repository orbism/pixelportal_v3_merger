import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Configuration } from '../config/configuration';

export interface SupportTicketEmailData {
  ticketId: number;
  email?: string;
  discordUsername?: string;
  telegramUsername?: string;
  xUsername?: string;
  message: string;
  createdAt: Date;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService<Configuration>) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const smtp = this.configService.get('smtp');

    // Only initialize if SMTP is configured
    if (smtp?.host && smtp?.port && smtp?.user && smtp?.pass) {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: Number(smtp.port),
        secure: Number(smtp.port) === 465, // true for 465, false for other ports
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      });
      this.logger.log('Email service initialized with SMTP transport');
    } else {
      this.logger.warn(
        'SMTP not configured. Email notifications will be disabled. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS environment variables.',
      );
    }
  }

  async sendSupportTicketNotification(data: SupportTicketEmailData): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn('Email service not configured. Skipping email notification.');
      return false;
    }

    const recipients = this.configService.get('supportEmailRecipients');
    if (!recipients) {
      this.logger.warn('SUPPORT_EMAIL_RECIPIENTS not configured. Skipping email notification.');
      return false;
    }

    const recipientList = recipients.split(',').map(email => email.trim());

    const contactInfo = [
      data.email ? `Email: ${data.email}` : null,
      data.discordUsername ? `Discord: ${data.discordUsername}` : null,
      data.telegramUsername ? `Telegram: ${data.telegramUsername}` : null,
      data.xUsername ? `X (Twitter): ${data.xUsername}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const emailHtml = `
      <h2>New Support Ticket #${data.ticketId}</h2>
      <p><strong>Submitted:</strong> ${data.createdAt.toLocaleString()}</p>
      
      <h3>Contact Information:</h3>
      <pre>${contactInfo}</pre>
      
      <h3>Message:</h3>
      <p>${data.message.replace(/\n/g, '<br>')}</p>
      
      <hr>
      <p style="color: #666; font-size: 12px;">
        This is an automated notification from Doge Pixels Support System
      </p>
    `;

    const emailText = `
New Support Ticket #${data.ticketId}
Submitted: ${data.createdAt.toLocaleString()}

Contact Information:
${contactInfo}

Message:
${data.message}

---
This is an automated notification from Doge Pixels Support System
    `;

    try {
      const smtp = this.configService.get('smtp');
      const info = await this.transporter.sendMail({
        from: smtp?.from || smtp?.user,
        to: recipientList,
        subject: `[Doge Pixels Support] New Ticket #${data.ticketId}`,
        text: emailText,
        html: emailHtml,
      });

      this.logger.log(`Support ticket email sent: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send support ticket email', error);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully');
      return true;
    } catch (error) {
      this.logger.error('SMTP connection verification failed', error);
      return false;
    }
  }
}

