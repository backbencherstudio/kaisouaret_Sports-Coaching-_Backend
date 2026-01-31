import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CustomOfferDto {
  @IsNotEmpty()
  @IsString()
  booking_id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  duration_minutes?: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  number_of_members: number;

  @IsNotEmpty()
  @IsString()
  appointment_date: string;

  @IsNotEmpty()
  @IsString()
  startTime: string;

  @IsNotEmpty()
  @IsString()
  endTime: string;

  @IsOptional()
  @IsString()
  conversation_id?: string;
}
