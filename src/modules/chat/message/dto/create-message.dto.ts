import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMessageDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty()
  receiver_id: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty()
  conversation_id: string;

  @IsOptional()
  @IsString()
  @ApiProperty()
  message?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Existing attachment id' })
  attachment_id?: string;

  @IsOptional()
  @ApiProperty({
    required: false,
    description: 'Attachment metadata for socket/direct sends',
    type: Object,
  })
  attachment?: {
    name?: string;
    type?: string;
    size?: number;
    file?: string;
    file_alt?: string;
    format?: string;
  };

  @IsOptional()
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'File attachment (image, video, document, etc.)',
  })
  file?: Express.Multer.File;
}
