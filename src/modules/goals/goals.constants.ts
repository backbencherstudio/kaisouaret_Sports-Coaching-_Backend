// Goals module constants and configuration
export const GOALS_CONFIG = {
  // Maximum goals per user
  MAX_GOALS_PER_USER: 10,

  // Progress tracking limits
  MAX_PROGRESS_ENTRIES_PER_GOAL: 365, // 1 year of daily entries
  PAGINATION_MIN_LIMIT: 1,
  PAGINATION_MAX_LIMIT: 100,
  PAGINATION_DEFAULT_LIMIT: 20,

  // Numeric field limits
  FREQUENCY_PER_WEEK_MIN: 1,
  FREQUENCY_PER_WEEK_MAX: 7,

  // String length limits
  TITLE_MIN_LENGTH: 3,
  TITLE_MAX_LENGTH: 100,
  MOTIVATION_MAX_LENGTH: 500,
  NOTE_MAX_LENGTH: 1000,
  CURRENT_VALUE_MAX_LENGTH: 50,
  TARGET_VALUE_MAX_LENGTH: 50,

  // Date validation
  MIN_DAYS_UNTIL_TARGET: 1, // target date must be at least 1 day in future
  MAX_DAYS_UNTIL_TARGET: 1825, // ~5 years
};

export enum GoalStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

export const GOAL_ERROR_MESSAGES = {
  GOAL_NOT_FOUND: 'Goal not found',
  USER_ID_REQUIRED: 'User ID is required',
  COACH_ID_REQUIRED: 'Coach ID is required',
  COACH_NOT_FOUND: 'Specified coach not found',
  INVALID_GOAL_TITLE: 'Goal title must be between 3 and 100 characters',
  INVALID_MOTIVATION: 'Motivation text cannot exceed 500 characters',
  INVALID_FREQUENCY: 'Frequency per week must be between 1 and 7',
  INVALID_TARGET_DATE: 'Target date must be at least 1 day in the future and within 5 years',
  INVALID_PROGRESS_VALUE: 'Progress values must be non-negative numbers',
  INVALID_NUMERIC_VALUE: 'Current and target values must be valid numbers if provided',
  GOAL_LIMIT_EXCEEDED: `Maximum ${GOALS_CONFIG.MAX_GOALS_PER_USER} goals per user reached`,
  DUPLICATE_GOAL_TITLE: 'A goal with this title already exists',
  ACCESS_DENIED: 'You do not have permission to perform this action',
  COACH_ROLE_REQUIRED: 'Only coaches can perform this action',
  INVALID_COACH: 'Assigned user is not a valid coach',
  PROGRESS_LIMIT_EXCEEDED: 'Progress entry limit exceeded for this goal',
  INVALID_NOTE: 'Coach note cannot exceed 1000 characters',
  INVALID_PAGINATION: `Limit must be between ${GOALS_CONFIG.PAGINATION_MIN_LIMIT} and ${GOALS_CONFIG.PAGINATION_MAX_LIMIT}`,
  INVALID_RECORDED_DATE: 'Recorded date cannot be in the future',
};
