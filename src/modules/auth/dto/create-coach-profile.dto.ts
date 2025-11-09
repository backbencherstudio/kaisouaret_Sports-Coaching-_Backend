import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString } from 'class-validator';

export class CreateCoachProfileDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  bio?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  specialty?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  experience_level?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  certifications?: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false, type: Number })
  hourly_rate?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  hourly_currency?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  phone_number?: string;
}
