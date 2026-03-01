import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max, IsEmail, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { UserStatus } from './query-user-list.dto';

export class UpdateUserListDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'User name' })
  name?: string;

  @IsOptional()
  @IsEmail()
  @ApiProperty({ required: false, description: 'User email' })
  email?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Phone number' })
  phone_number?: string;

  @IsOptional()
  @IsEnum(UserStatus, { message: 'status must be one of: active, blocked' })
  @ApiProperty({ 
    required: false, 
    enum: ['active', 'blocked'],
    description: 'User status (active or blocked)' 
  })
  status?: UserStatus;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'User bio' })
  bio?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'User location' })
  location?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'User address' })
  address?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'User gender' })
  gender?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(150)
  @ApiProperty({ required: false, description: 'User age' })
  age?: number;
}
