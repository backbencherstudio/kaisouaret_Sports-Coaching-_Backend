import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MetricFieldDefinition {
  @IsString({ message: 'Field name is required' })
  name: string; // e.g., "Weight", "Calories Burned", "Distance"

  @IsString({ message: 'Unit is required' })
  unit: string; // e.g., "kg", "kcal", "km", "bpm"

  @IsOptional()
  @IsString()
  description?: string; // e.g., "Body weight in kilograms"
}

export class MetricsDefinition {
  @IsOptional()
  @ValidateNested()
  @Type(() => MetricFieldDefinition)
  previous_value?: MetricFieldDefinition;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetricFieldDefinition)
  current_value?: MetricFieldDefinition;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetricFieldDefinition)
  session_duration_minutes?: MetricFieldDefinition;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetricFieldDefinition)
  performance_metric_1?: MetricFieldDefinition;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetricFieldDefinition)
  performance_metric_2?: MetricFieldDefinition;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetricFieldDefinition)
  performance_metric_3?: MetricFieldDefinition;
}
