import {
  IsOptional,
  IsNumber,
  IsString,
  IsInt,
  IsDateString,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { GOALS_CONFIG } from '../goals.constants';

export class ProgressDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Previous value must be a valid number' })
  @Min(0, { message: 'Previous value cannot be negative' })
  previous_value?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Current value must be a valid number' })
  @Min(0, { message: 'Current value cannot be negative' })
  current_value?: number;

  @IsOptional()
  @IsInt({ message: 'Session duration must be an integer (minutes)' })
  @Min(1, { message: 'Session duration must be at least 1 minute' })
  @Max(1440, { message: 'Session duration cannot exceed 24 hours (1440 minutes)' })
  session_duration_minutes?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Performance metric 1 must be a valid number' })
  @Min(0, { message: 'Performance metric 1 cannot be negative' })
  @Max(100000, { message: 'Performance metric 1 value seems too high' })
  performance_metric_1?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Performance metric 2 must be a valid number' })
  @Min(0, { message: 'Performance metric 2 cannot be negative' })
  @Max(100000, { message: 'Performance metric 2 value seems too high' })
  performance_metric_2?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Performance metric 3 must be a valid number' })
  @Min(0, { message: 'Performance metric 3 cannot be negative' })
  @Max(100000, { message: 'Performance metric 3 value seems too high' })
  performance_metric_3?: number;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Recorded date must be a valid ISO 8601 date' })
  recorded_at?: string;

  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @MaxLength(GOALS_CONFIG.NOTE_MAX_LENGTH, {
    message: `Notes cannot exceed ${GOALS_CONFIG.NOTE_MAX_LENGTH} characters`,
  })
  notes?: string;
}
