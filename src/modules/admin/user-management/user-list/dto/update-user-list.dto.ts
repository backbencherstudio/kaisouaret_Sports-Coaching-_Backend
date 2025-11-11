import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max, IsEmail, IsEnum } from 'class-validator';
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
  @IsEnum([UserStatus.ACTIVE, UserStatus.BLOCKED])
  @ApiProperty({ 
    required: false, 
    enum: [UserStatus.ACTIVE, UserStatus.BLOCKED],
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
  @IsInt()
  @Min(1)
  @Max(150)
  @ApiProperty({ required: false, description: 'User age' })
  age?: number;
}
