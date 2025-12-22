import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EmailService } from '../email/email.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { SupportTicket } from '@prisma/client';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async createSupportTicket(dto: CreateSupportTicketDto): Promise<SupportTicket> {
    this.logger.log('Creating new support ticket');

    // Create the ticket in the database
    const ticket = await this.prisma.supportTicket.create({
      data: {
        email: dto.email,
        discordUsername: dto.discordUsername,
        telegramUsername: dto.telegramUsername,
        xUsername: dto.xUsername,
        message: dto.message,
      },
    });

    this.logger.log(`Support ticket created with ID: ${ticket.id}`);

    // Send email notification (non-blocking)
    this.emailService
      .sendSupportTicketNotification({
        ticketId: ticket.id,
        email: ticket.email,
        discordUsername: ticket.discordUsername,
        telegramUsername: ticket.telegramUsername,
        xUsername: ticket.xUsername,
        message: ticket.message,
        createdAt: ticket.createdAt,
      })
      .catch((error) => {
        this.logger.error('Failed to send email notification for ticket', error);
      });

    return ticket;
  }

  async getSupportTickets(limit: number = 50): Promise<SupportTicket[]> {
    return this.prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getSupportTicketById(id: number): Promise<SupportTicket | null> {
    return this.prisma.supportTicket.findUnique({
      where: { id },
    });
  }
}

