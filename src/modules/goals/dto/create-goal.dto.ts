import { IsNotEmpty, IsOptional, IsString, IsInt, IsDateString } from 'class-validator';

export class CreateGoalDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  current_value?: string;

  @IsOptional()
  @IsString()
  target_value?: string;

  @IsOptional()
  @IsDateString()
  target_date?: string;

  @IsOptional()
  @IsInt()
  frequency_per_week?: number;

  @IsOptional()
  @IsString()
  motivation?: string;
}
