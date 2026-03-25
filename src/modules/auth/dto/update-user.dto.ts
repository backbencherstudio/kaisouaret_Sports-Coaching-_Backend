import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { IsOptional } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional()
  @ApiProperty({
    description: 'Full name of the user',
    example: 'John Doe',
  })
  name?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Phone number',
    example: '+91 9876543210',
  })
  phone_number?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Country',
    example: 'Nigeria',
  })
  country?: string;

  @IsOptional()
  @ApiProperty({
    description: 'State',
    example: 'Lagos',
  })
  state?: string;

  @IsOptional()
  @ApiProperty({
    description: 'City',
    example: 'Lagos',
  })
  city?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Local government',
    example: 'Lagos',
  })
  local_government?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Zip code',
    example: '123456',
  })
  zip_code?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Address',
    example: 'New York, USA',
  })
  address?: string;

  @IsOptional()
  @ApiProperty({
    description: 'location',
    example: 'New York, USA',
  })
  location?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Latitude',
    example: 40.7128,
  })
  latitude?: number;

  @IsOptional()
  @ApiProperty({
    description: 'Longitude',
    example: -74.006,
  })
  longitude?: number;

  @IsOptional()
  @ApiProperty({
    description: 'Gender',
    example: 'male',
  })
  gender?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Date of birth ',
    example: '04/11/2001',
  })
  date_of_birth?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Profile image',
    example: 'http://localhost:4000/api/users/avatar/1234567890',
  })
  avatar?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Bio',
    example: 'Passionate athlete dedicated to ...',
  })
  bio?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Objectives',
    example: 'To continuously improve my performance',
  })
  objectives?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Comma separated specialties or JSON string',
    example: 'Swimming,Endurance Training',
  })
  specialties?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Primary specialty',
    example: 'Swimming',
  })
  primary_specialty?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Comma separated sports or JSON string',
    example: 'Swimming,Running',
  })
  sports?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Comma separated goals or JSON string',
    example: 'Lose weight,Build muscle',
  })
  goals?: string;

  // coach-specific updatable fields
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
  session_price?: number;

  @IsOptional()
  @ApiProperty({ required: false })
  hourly_currency?: string;

  @IsOptional()
  @ApiProperty({ required: false })
  session_duration_minutes?: string;

  @IsOptional()
  @ApiProperty({
    description:
      'Languages spoken by the user (array or comma separated string)',
    example: 'English,Spanish',
  })
  languages?: string[];
}
