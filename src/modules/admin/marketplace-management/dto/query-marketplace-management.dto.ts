import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class QueryMarketplaceManagementDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Search by name, brand, description or category' })
  search?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Filter by category id' })
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    }
    return undefined;
  })
  @IsBoolean()
  @ApiProperty({ required: false, description: 'Filter by active status' })
  isActive?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    }
    return undefined;
  })
  @IsBoolean()
  @ApiProperty({
    required: false,
    description: 'Include image URLs in the response (base64 data is excluded)',
  })
  includeImage?: boolean;

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

