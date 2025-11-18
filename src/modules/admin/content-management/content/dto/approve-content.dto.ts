import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApproveContentDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Coach profile ID or User ID to approve' })
  id: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ 
    required: false,
    description: 'Type: "coach_profile" or "user"', 
    default: 'coach_profile' 
  })
  type?: string = 'coach_profile';
}

