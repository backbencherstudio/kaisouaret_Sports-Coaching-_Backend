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
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'File attachment (image, video, document, etc.)',
  })
  file?: Express.Multer.File;
}
