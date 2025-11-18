import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export class QueryBookingListDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Search by athlete name, coach name, or title' })
  search?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  @ApiProperty({ 
    required: false, 
    enum: BookingStatus,
    description: 'Filter by booking status' 
  })
  status?: BookingStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false, description: 'Page number', default: 1 })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false, description: 'Items per page', default: 10 })
  limit?: number = 10;
}

