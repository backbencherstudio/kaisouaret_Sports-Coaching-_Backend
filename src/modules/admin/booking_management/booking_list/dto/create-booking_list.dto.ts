import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString, IsInt, Min, IsEnum } from 'class-validator';

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export class CreateBookingListDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Booking title' })
  title?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Coach ID' })
  coach_id?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'User ID (Athlete)' })
  user_id?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Coach Profile ID' })
  coach_profile_id?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false, description: 'Appointment date' })
  appointment_date?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false, description: 'Session time' })
  session_time?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false, description: 'Duration in minutes' })
  duration_minutes?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Location' })
  location?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Description' })
  description?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Notes' })
  notes?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  @ApiProperty({ 
    required: false, 
    enum: BookingStatus,
    description: 'Booking status' 
  })
  status?: BookingStatus;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Session Package ID' })
  session_package_id?: string;
}
