import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, MinLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @ApiProperty()
  name?: string;

  @IsNotEmpty()
  @ApiProperty()
  email?: string;

  @IsNotEmpty()
  @MinLength(8, { message: 'Password should be minimum 8' })
  @ApiProperty()
  password: string;

  @IsNotEmpty()
  @ApiProperty()
  location?: string;

  @ApiProperty()
  referral?: string;

  @ApiProperty({
    type: String,
    example: 'user',
  })
  type?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  phone_number?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  bio?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  specialty?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  experience_level?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  certifications?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  hourly_rate?: number;

  @IsOptional()
  @ApiProperty({ required: false })
  hourly_currency?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  date_of_birth?: string;
}
