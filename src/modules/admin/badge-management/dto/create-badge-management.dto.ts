import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsObject, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateBadgeManagementDto {
  @ApiProperty({ description: 'Unique key identifier for the badge', example: 'first_session' })
  @IsString()
  key: string;

  @ApiProperty({ description: 'Display title of the badge', example: 'First Session Badge' })
  @IsString()
  title: string;

  @ApiProperty({ required: false, description: 'Badge description', example: 'Complete your first training session' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, description: 'Points awarded for earning this badge', example: 10, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  points?: number;

  @ApiProperty({ 
    required: false, 
    description: 'Badge icon image file (upload via multipart/form-data)', 
    type: 'string', 
    format: 'binary' 
  })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ 
    required: false, 
    description: 'Criteria for earning the badge (JSON string when using multipart/form-data)', 
    example: '{ "type": "count", "field": "completed_bookings", "value": 1 }'
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (e) {
        return value;
      }
    }
    return value;
  })
  @IsObject()
  criteria?: Record<string, any>;
}
