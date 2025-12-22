import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

@Controller('/v1/support')
export class SupportController {
  private readonly logger = new Logger(SupportController.name);

  constructor(private readonly supportService: SupportService) {}

  @Post('ticket')
  async createTicket(@Body() createTicketDto: CreateSupportTicketDto) {
    this.logger.log('Received support ticket submission');

    const ticket = await this.supportService.createSupportTicket(createTicketDto);

    return {
      success: true,
      message: 'Support ticket submitted successfully',
      ticketId: ticket.id,
    };
  }

  @Get('tickets')
  async getTickets() {
    const tickets = await this.supportService.getSupportTickets();
    return {
      success: true,
      tickets,
    };
  }

  @Get('ticket/:id')
  async getTicket(@Param('id') id: string) {
    const ticket = await this.supportService.getSupportTicketById(Number(id));
    return {
      success: true,
      ticket,
    };
  }
}

