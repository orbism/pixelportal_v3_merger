import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateSupportTicketDto {
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  discordUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  telegramUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  xUsername?: string;

  @IsNotEmpty({ message: 'Message is required' })
  @IsString()
  @MaxLength(5000, { message: 'Message cannot exceed 5000 characters' })
  message: string;

  // Custom validation: at least one contact method must be provided
  @ValidateIf((o) => !o.email && !o.discordUsername && !o.telegramUsername && !o.xUsername)
  @IsNotEmpty({ message: 'At least one contact method (email, discord, telegram, or X username) must be provided' })
  atLeastOneContact?: any;
}

