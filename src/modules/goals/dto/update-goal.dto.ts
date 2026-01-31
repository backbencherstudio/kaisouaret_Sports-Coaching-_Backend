import {
  IsOptional,
  IsString,
  IsInt,
  IsDateString,
  MinLength,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { GOALS_CONFIG } from '../goals.constants';

export class UpdateGoalDto {
  @IsOptional()
  @IsString({ message: 'Goal title must be a string' })
  @MinLength(GOALS_CONFIG.TITLE_MIN_LENGTH, {
    message: `Title must be at least ${GOALS_CONFIG.TITLE_MIN_LENGTH} characters`,
  })
  @MaxLength(GOALS_CONFIG.TITLE_MAX_LENGTH, {
    message: `Title cannot exceed ${GOALS_CONFIG.TITLE_MAX_LENGTH} characters`,
  })
  title?: string;

  @IsOptional()
  @IsString({ message: 'Current value must be a string' })
  @MaxLength(GOALS_CONFIG.CURRENT_VALUE_MAX_LENGTH)
  current_value?: string;

  @IsOptional()
  @IsString({ message: 'Target value must be a string' })
  @MaxLength(GOALS_CONFIG.TARGET_VALUE_MAX_LENGTH)
  target_value?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Target date must be a valid ISO 8601 date' })
  target_date?: string;

  @IsOptional()
  @IsInt({ message: 'Frequency per week must be an integer' })
  @Min(GOALS_CONFIG.FREQUENCY_PER_WEEK_MIN)
  @Max(GOALS_CONFIG.FREQUENCY_PER_WEEK_MAX)
  frequency_per_week?: number;

  @IsOptional()
  @IsString({ message: 'Motivation must be a string' })
  @MaxLength(GOALS_CONFIG.MOTIVATION_MAX_LENGTH)
  motivation?: string;
}
