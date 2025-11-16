import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum } from 'class-validator';

export enum RecipientType {
  ALL = 'all',
  COACHES = 'coaches',
  ATHLETES = 'athletes',
  SPECIFIC = 'specific',
}

export class SendBulkNotificationDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({ 
    description: 'Notification title',
    example: 'New Session Available'
  })
  notification_title: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ 
    description: 'Message content',
    example: 'We have exciting new training sessions available. Book now!'
  })
  message_content: string;

  @IsNotEmpty()
  @IsEnum(RecipientType)
  @ApiProperty({ 
    description: 'Recipient type',
    enum: RecipientType,
    example: RecipientType.ALL
  })
  recipient_type: RecipientType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ApiProperty({ 
    description: 'Specific user IDs (required if recipient_type is specific)',
    type: [String],
    required: false,
    example: ['user-id-1', 'user-id-2']
  })
  recipient_ids?: string[];
}

