import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectContentDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Coach profile ID or User ID to reject' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Type: "coach_profile" or "user"', default: 'coach_profile' })
  type: string = 'coach_profile';

  @IsString()
  @IsOptional()
  @ApiProperty({ required: false, description: 'Reason for rejection' })
  reason?: string;
}

