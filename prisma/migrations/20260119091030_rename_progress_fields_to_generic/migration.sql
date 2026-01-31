/*
  Warnings:

  - Renamed columns to use generic naming convention for multi-type goal support
  - Data is preserved through column renaming

*/
-- Rename columns to generic names (preserves existing data)
ALTER TABLE "goal_progress" 
  RENAME COLUMN "previous_weight" TO "previous_value";

ALTER TABLE "goal_progress" 
  RENAME COLUMN "current_weight" TO "current_value";

ALTER TABLE "goal_progress" 
  RENAME COLUMN "training_duration" TO "session_duration_minutes";

ALTER TABLE "goal_progress" 
  RENAME COLUMN "calories_burned" TO "performance_metric_1";

ALTER TABLE "goal_progress" 
  RENAME COLUMN "calories_gained" TO "performance_metric_2";

ALTER TABLE "goal_progress" 
  RENAME COLUMN "sets_per_session" TO "performance_metric_3";

-- Change data type of int columns to float for flexibility
ALTER TABLE "goal_progress" 
  ALTER COLUMN "performance_metric_1" TYPE DOUBLE PRECISION USING "performance_metric_1"::DOUBLE PRECISION;

ALTER TABLE "goal_progress" 
  ALTER COLUMN "performance_metric_2" TYPE DOUBLE PRECISION USING "performance_metric_2"::DOUBLE PRECISION;

ALTER TABLE "goal_progress" 
  ALTER COLUMN "performance_metric_3" TYPE DOUBLE PRECISION USING "performance_metric_3"::DOUBLE PRECISION;
