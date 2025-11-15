import {
  IsOptional,
  IsNumber,
  IsString,
  IsInt,
  IsDateString,
} from 'class-validator';

export class ProgressDto {
  @IsOptional()
  @IsNumber()
  previous_weight?: number;

  @IsOptional()
  @IsNumber()
  current_weight?: number;

  @IsOptional()
  @IsInt()
  training_duration?: number;

  @IsOptional()
  @IsInt()
  calories_burned?: number;

  @IsOptional()
  @IsInt()
  calories_gained?: number;

  @IsOptional()
  @IsInt()
  sets_per_session?: number;

  @IsOptional()
  @IsDateString()
  recorded_at?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
