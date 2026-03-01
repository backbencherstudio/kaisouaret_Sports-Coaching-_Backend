import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GOALS_CONFIG, GOAL_ERROR_MESSAGES } from './goals.constants';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';

@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Validate that target date is valid (in future, within 5 years)
   */
  private validateTargetDate(targetDate?: string): void {
    if (!targetDate) return;

    const date = new Date(targetDate);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_TARGET_DATE);
    }
    const now = new Date();
    const diffDays = Math.floor(
      (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays < GOALS_CONFIG.MIN_DAYS_UNTIL_TARGET) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_TARGET_DATE);
    }

    if (diffDays > GOALS_CONFIG.MAX_DAYS_UNTIL_TARGET) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_TARGET_DATE);
    }
  }

  /**
   * Validate goal title length and return trimmed title
   */
  private validateTitle(title?: string): string {
    const trimmed = title?.trim() ?? '';
    if (
      trimmed.length < GOALS_CONFIG.TITLE_MIN_LENGTH ||
      trimmed.length > GOALS_CONFIG.TITLE_MAX_LENGTH
    ) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_GOAL_TITLE);
    }
    return trimmed;
  }

  /**
   * Validate motivation length and return trimmed value or null
   */
  private validateMotivation(motivation?: string | null): string | null {
    if (motivation === undefined || motivation === null) return null;
    const trimmed = motivation.trim();
    if (trimmed.length > GOALS_CONFIG.MOTIVATION_MAX_LENGTH) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_MOTIVATION);
    }
    return trimmed || null;
  }

  /**
   * Validate frequency per week is within allowed range
   */
  private validateFrequency(frequency?: number | null): number | null {
    if (frequency === undefined || frequency === null) return null;
    if (
      !Number.isInteger(frequency) ||
      frequency < GOALS_CONFIG.FREQUENCY_PER_WEEK_MIN ||
      frequency > GOALS_CONFIG.FREQUENCY_PER_WEEK_MAX
    ) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_FREQUENCY);
    }
    return frequency;
  }

  /**
   * Validate coach note length and return trimmed value
   */
  private validateNote(note: string): string {
    const trimmed = note?.trim() ?? '';
    if (!trimmed || trimmed.length > GOALS_CONFIG.NOTE_MAX_LENGTH) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_NOTE);
    }
    return trimmed;
  }

  /**
   * Validate progress numeric values are non-negative numbers when provided
   */
  private validateProgressValues(payload: any): void {
    const fields: Array<{ key: string }> = [
      { key: 'previous_value' },
      { key: 'current_value' },
      { key: 'session_duration_minutes' },
      { key: 'performance_metric_1' },
      { key: 'performance_metric_2' },
      { key: 'performance_metric_3' },
    ];

    for (const field of fields) {
      const value = payload[field.key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
        throw new BadRequestException(
          GOAL_ERROR_MESSAGES.INVALID_PROGRESS_VALUE,
        );
      }
    }

    if (payload.notes && payload.notes.length > GOALS_CONFIG.NOTE_MAX_LENGTH) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_NOTE);
    }
  }

  /**
   * Validate numeric values (if provided, must be parseable numbers)
   */
  private validateNumericValues(
    currentValue?: string,
    targetValue?: string,
  ): void {
    if (currentValue && isNaN(parseFloat(currentValue))) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_NUMERIC_VALUE);
    }

    if (targetValue && isNaN(parseFloat(targetValue))) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_NUMERIC_VALUE);
    }
  }

  /**
   * Check if user is a coach
   */
  private async validateCoachUser(coachId: string): Promise<any> {
    const coach = await this.prisma.user.findUnique({
      where: { id: coachId },
      include: { coach_profile: true },
    });

    if (!coach) {
      throw new NotFoundException(GOAL_ERROR_MESSAGES.COACH_NOT_FOUND);
    }

    if (!coach.coach_profile) {
      throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_COACH);
    }

    return coach;
  }

  /**
   * Check user goal count limit
   */
  private async checkGoalLimit(userId: string): Promise<void> {
    const count = await this.prisma.goal.count({
      where: { user_id: userId },
    });

    if (count >= GOALS_CONFIG.MAX_GOALS_PER_USER) {
      throw new ConflictException(GOAL_ERROR_MESSAGES.GOAL_LIMIT_EXCEEDED);
    }
  }

  /**
   * Create a new goal for a user
   */
  async createGoal(userId: string, payload: any) {
    try {
      if (!userId) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.USER_ID_REQUIRED);
      }

      // Validate goal limit
      await this.checkGoalLimit(userId);

      const title = this.validateTitle(payload.title);

      this.validateNumericValues(payload.current_value, payload.target_value);
      this.validateTargetDate(payload.target_date);
      const frequency = this.validateFrequency(payload.frequency_per_week);
      const motivation = this.validateMotivation(payload.motivation);

      // Check for duplicate goal title for this user
      const existingGoal = await this.prisma.goal.findFirst({
        where: {
          user_id: userId,
          title: { equals: title, mode: 'insensitive' },
        },
      });

      if (existingGoal) {
        throw new ConflictException(GOAL_ERROR_MESSAGES.DUPLICATE_GOAL_TITLE);
      }

      const data: any = {
        user_id: userId,
        title,
        current_value: payload.current_value?.trim() ?? null,
        target_value: payload.target_value?.trim() ?? null,
        target_date: payload.target_date ? new Date(payload.target_date) : null,
        frequency_per_week: frequency,
        motivation,
        progress_percent: 0,
      };

      // Validate and attach coach if provided
      if (payload.coach_id) {
        await this.validateCoachUser(payload.coach_id);
        data.coach_id = payload.coach_id;
      }

      const goal = await this.prisma.goal.create({ data });

      this.logger.log(
        `Goal created: ${goal.id} for user ${userId} with title "${goal.title}"`,
      );

      // Send goal created notification
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });

        if (user) {
          await this.notificationsService.sendNotification({
            type: NotificationType.GOAL_CREATED,
            recipient_id: userId,
            entity_id: goal.id,
            variables: {
              user_name: user.name,
              goal_title: goal.title,
              target_date: goal.target_date
                ? new Date(goal.target_date).toISOString().split('T')[0]
                : 'No deadline',
            },
          });
        }
      } catch (error) {
        this.logger.error('Failed to send goal created notification:', error);
      }

      return {
        success: true,
        message: 'Goal created successfully',
        data: { goal },
      };
    } catch (error) {
      this.logger.error(`Error creating goal for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update an existing goal
   */
  async updateGoal(userId: string, goalId: string, payload: any) {
    try {
      if (!userId) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.USER_ID_REQUIRED);
      }

      const existing = await this.prisma.goal.findUnique({
        where: { id: goalId },
      });

      if (!existing) {
        throw new NotFoundException(GOAL_ERROR_MESSAGES.GOAL_NOT_FOUND);
      }

      // Verify ownership
      if (existing.user_id !== userId) {
        throw new ForbiddenException(GOAL_ERROR_MESSAGES.ACCESS_DENIED);
      }

      // Validate numeric values if provided
      if (
        payload.current_value !== undefined ||
        payload.target_value !== undefined
      ) {
        this.validateNumericValues(payload.current_value, payload.target_value);
      }

      // Validate target date if provided
      if (payload.target_date !== undefined) {
        this.validateTargetDate(payload.target_date);
      }

      const newTitle =
        payload.title !== undefined
          ? this.validateTitle(payload.title)
          : existing.title;

      const motivation =
        payload.motivation !== undefined
          ? this.validateMotivation(payload.motivation)
          : existing.motivation;

      const frequency =
        payload.frequency_per_week !== undefined
          ? this.validateFrequency(payload.frequency_per_week)
          : existing.frequency_per_week;

      const duplicate = await this.prisma.goal.findFirst({
        where: {
          user_id: userId,
          title: { equals: newTitle, mode: 'insensitive' },
          NOT: { id: goalId },
        },
      });

      if (duplicate) {
        throw new ConflictException(GOAL_ERROR_MESSAGES.DUPLICATE_GOAL_TITLE);
      }

      const updateData: any = {
        updated_at: new Date(),
        title: newTitle,
      };

      if (payload.current_value !== undefined) {
        updateData.current_value = payload.current_value?.trim() ?? null;
      }
      if (payload.target_value !== undefined) {
        updateData.target_value = payload.target_value?.trim() ?? null;
      }
      if (payload.target_date !== undefined) {
        updateData.target_date = payload.target_date
          ? new Date(payload.target_date)
          : null;
      }
      if (payload.frequency_per_week !== undefined) {
        updateData.frequency_per_week = frequency;
      }
      if (payload.motivation !== undefined) {
        updateData.motivation = motivation;
      }

      const updated = await this.prisma.goal.update({
        where: { id: goalId },
        data: updateData,
      });

      this.logger.log(`Goal updated: ${goalId}`);

      return {
        success: true,
        message: 'Goal updated successfully',
        data: { goal: updated },
      };
    } catch (error) {
      this.logger.error(
        `Error updating goal ${goalId} for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all coaches from bookings for a specific user
   */
  async getMyCoaches(userId: string) {
    try {
      if (!userId) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.USER_ID_REQUIRED);
      }

      const bookings = await this.prisma.booking.findMany({
        where: { user_id: userId },
        select: {
          id: true,
          title: true,
          coach_profile: {
            select: {
              user_id: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                  email: true,
                  phone_number: true,
                },
              },
            },
          },
        },
        distinct: ['coach_id'], // Get unique coaches only
      });

      // Extract unique coaches
      const coachesMap = new Map();
      for (const booking of bookings) {
        const coach = booking.coach_profile?.user;
        if (coach && !coachesMap.has(coach.id)) {
          coachesMap.set(coach.id, coach);
        }
      }

      const coaches = Array.from(coachesMap.values());

      this.logger.log(`Fetched ${coaches.length} coaches for user ${userId}`);

      return {
        success: true,
        message: 'Coaches fetched successfully',
        data: { coaches },
      };
    } catch (error) {
      this.logger.error(`Error fetching coaches for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get all goals for a user with aggregated progress
   */
  async getMyGoals(userId: string) {
    try {
      if (!userId) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.USER_ID_REQUIRED);
      }

      const goals = await this.prisma.goal.findMany({
        where: { user_id: userId },
        include: {
          progress: { orderBy: { created_at: 'desc' }, take: 1 },
          coach_notes: { orderBy: { created_at: 'desc' }, take: 3 },
        },
      });

      const mapped = goals.map((g) => {
        const latest = g.progress?.[0] ?? null;

        // Calculate progress percentage
        let percent: number | null = null;
        if (typeof g.progress_percent === 'number' && g.progress_percent >= 0) {
          percent = g.progress_percent;
        } else {
          const currentVal = parseFloat(
            String(latest?.current_value ?? g.current_value ?? ''),
          );
          const targetVal = parseFloat(String(g.target_value ?? ''));

          if (
            !Number.isNaN(currentVal) &&
            !Number.isNaN(targetVal) &&
            targetVal > 0
          ) {
            percent = Math.min(100, Math.floor((currentVal / targetVal) * 100));
          }
        }

        // Format progress label
        let progress_label: string | null = null;
        if (latest?.current_value != null && g.target_value != null) {
          progress_label = `${latest.current_value}/${g.target_value}`;
        } else if (g.current_value != null && g.target_value != null) {
          progress_label = `${g.current_value}/${g.target_value}`;
        }
        return {
          id: g.id,
          title: g.title,
          progress_percent: percent ?? 0,
          current_value: latest?.current_value ?? g.current_value,
          target_value: g.target_value,
          target_date: g.target_date,
          frequency_per_week: g.frequency_per_week,
          motivation: g.motivation,
          latest_progress: latest,
          coach_notes: g.coach_notes ?? [],
          progress_label,
          created_at: g.created_at,
          updated_at: g.updated_at,
        };
      });

      // Calculate overall progress
      const percents = mapped
        .map((m) =>
          typeof m.progress_percent === 'number' ? m.progress_percent : null,
        )
        .filter((p) => p !== null) as number[];

      const overall_percent = percents.length
        ? Math.floor(percents.reduce((a, b) => a + b, 0) / percents.length)
        : 0;

      this.logger.log(`Fetched ${goals.length} goals for user ${userId}`);

      return {
        success: true,
        message: 'Goals fetched successfully',
        data: {
          overall_percent,
          goals: mapped,
          total: goals.length,
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching goals for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific goal by ID
   */
  async getGoal(goalId: string, userId?: string) {
    try {
      const goal = await this.prisma.goal.findUnique({
        where: { id: goalId },
        include: {
          progress: { orderBy: { created_at: 'desc' } },
          coach_notes: { orderBy: { created_at: 'desc' } },
        },
      });

      if (!goal) {
        throw new NotFoundException(GOAL_ERROR_MESSAGES.GOAL_NOT_FOUND);
      }

      // Verify access: owner or assigned coach
      if (userId && goal.user_id !== userId && goal.coach_id !== userId) {
        throw new ForbiddenException(GOAL_ERROR_MESSAGES.ACCESS_DENIED);
      }

      return {
        success: true,
        message: 'Goal fetched successfully',
        data: { goal },
      };
    } catch (error) {
      this.logger.error(`Error fetching goal ${goalId}:`, error);
      throw error;
    }
  }

  /**
   * Add progress entry to a goal
   */
  async addProgress(userId: string, goalId: string, payload: any) {
    try {
      const goal = await this.prisma.goal.findUnique({
        where: { id: goalId },
      });

      if (!goal) {
        throw new NotFoundException(GOAL_ERROR_MESSAGES.GOAL_NOT_FOUND);
      }

      // Verify ownership
      if (goal.user_id !== userId) {
        throw new ForbiddenException(GOAL_ERROR_MESSAGES.ACCESS_DENIED);
      }

      // Check progress limit
      const progressCount = await this.prisma.goalProgress.count({
        where: { goal_id: goalId },
      });

      if (progressCount >= GOALS_CONFIG.MAX_PROGRESS_ENTRIES_PER_GOAL) {
        throw new ConflictException(
          GOAL_ERROR_MESSAGES.PROGRESS_LIMIT_EXCEEDED,
        );
      }

      // Validate recorded_at is not in future
      if (payload.recorded_at) {
        const recordedDate = new Date(payload.recorded_at);
        if (Number.isNaN(recordedDate.getTime())) {
          throw new BadRequestException(
            GOAL_ERROR_MESSAGES.INVALID_RECORDED_DATE,
          );
        }
        if (recordedDate > new Date()) {
          throw new BadRequestException(
            GOAL_ERROR_MESSAGES.INVALID_RECORDED_DATE,
          );
        }
      }

      this.validateProgressValues(payload);

      const trimmedProgressNote = payload.notes?.trim();
      const progress = await this.prisma.goalProgress.create({
        data: {
          goal_id: goalId,
          recorded_at: payload.recorded_at
            ? new Date(payload.recorded_at)
            : new Date(),
          previous_value: payload.previous_value ?? null,
          current_value: payload.current_value ?? null,
          session_duration_minutes: payload.session_duration_minutes ?? null,
          performance_metric_1: payload.performance_metric_1 ?? null,
          performance_metric_2: payload.performance_metric_2 ?? null,
          performance_metric_3: payload.performance_metric_3 ?? null,
          notes: trimmedProgressNote?.length ? trimmedProgressNote : null,
        },
      });

      // Update aggregated progress_percent
      try {
        const mostRecent = await this.prisma.goalProgress.findFirst({
          where: { goal_id: goalId },
          orderBy: { created_at: 'desc' },
        });

        if (
          mostRecent &&
          mostRecent.current_value != null &&
          goal.target_value
        ) {
          const currentVal = parseFloat(String(mostRecent.current_value));
          const targetVal = parseFloat(String(goal.target_value));

          if (
            !Number.isNaN(currentVal) &&
            !Number.isNaN(targetVal) &&
            targetVal > 0
          ) {
            const percent = Math.min(
              100,
              Math.floor((currentVal / targetVal) * 100),
            );
            await this.prisma.goal.update({
              where: { id: goalId },
              data: { progress_percent: percent, updated_at: new Date() },
            });
          }
        }
      } catch (e) {
        this.logger.warn(
          `Failed to update progress percentage for goal ${goalId}:`,
          e,
        );
      }

      this.logger.log(`Progress added to goal ${goalId}`);

      return {
        success: true,
        message: 'Progress added successfully',
        data: { progress },
      };
    } catch (error) {
      this.logger.error(
        `Error adding progress to goal ${goalId} for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * List progress entries for a goal with pagination
   */
  async listProgress(
    goalId: string,
    page = 1,
    limit = GOALS_CONFIG.PAGINATION_DEFAULT_LIMIT,
  ) {
    try {
      // Validate pagination parameters
      if (page < 1) page = 1;
      if (limit < GOALS_CONFIG.PAGINATION_MIN_LIMIT) {
        limit = GOALS_CONFIG.PAGINATION_MIN_LIMIT;
      }
      if (limit > GOALS_CONFIG.PAGINATION_MAX_LIMIT) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_PAGINATION);
      }

      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        this.prisma.goalProgress.findMany({
          where: { goal_id: goalId },
          orderBy: { created_at: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.goalProgress.count({ where: { goal_id: goalId } }),
      ]);

      return {
        success: true,
        message: 'Progress entries fetched successfully',
        data: {
          items,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      this.logger.error(`Error listing progress for goal ${goalId}:`, error);
      throw error;
    }
  }

  /**
   * Add a coach note to a goal
   */
  async addCoachNote(coachId: string, goalId: string, note: string) {
    try {
      if (!coachId) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.COACH_ID_REQUIRED);
      }

      const trimmedNote = this.validateNote(note);

      // Verify coach exists and has coach profile
      const coach = await this.prisma.user.findUnique({
        where: { id: coachId },
        include: { coach_profile: true },
      });

      if (!coach || !coach.coach_profile) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.INVALID_COACH);
      }

      const goal = await this.prisma.goal.findUnique({
        where: { id: goalId },
      });

      if (!goal) {
        throw new NotFoundException(GOAL_ERROR_MESSAGES.GOAL_NOT_FOUND);
      }

      // Verify coach is assigned to this goal
      if (goal.coach_id !== coachId) {
        throw new ForbiddenException('This coach is not assigned to this goal');
      }

      const gn = await this.prisma.goalNote.create({
        data: {
          user_id: goal.user_id,
          coach_id: coachId,
          goal_id: goalId,
          note: trimmedNote,
        },
      });

      this.logger.log(`Coach note added to goal ${goalId} by coach ${coachId}`);
      return {
        success: true,
        message: 'Coach note added successfully',
        data: { note: gn },
      };
    } catch (error) {
      this.logger.error(`Error adding coach note to goal ${goalId}:`, error);
      throw error;
    }
  }

  /**
   * Assign a coach to a goal (owner only)
   */
  async assignCoach(userId: string, goalId: string, coachId: string) {
    try {
      const goal = await this.prisma.goal.findUnique({
        where: { id: goalId },
      });

      if (!goal) {
        throw new NotFoundException(GOAL_ERROR_MESSAGES.GOAL_NOT_FOUND);
      }

      // Verify ownership
      if (goal.user_id !== userId) {
        throw new ForbiddenException(GOAL_ERROR_MESSAGES.ACCESS_DENIED);
      }

      // Validate coach exists and has coach profile
      const coach = await this.validateCoachUser(coachId);

      const updated = await this.prisma.goal.update({
        where: { id: goalId },
        data: { coach_id: coachId, updated_at: new Date() },
      });

      this.logger.log(
        `Coach ${coachId} assigned to goal ${goalId} by user ${userId}`,
      );
      return {
        success: true,
        message: `Coach ${coach.name} assigned successfully`,
        data: { goal: updated },
      };
    } catch (error) {
      this.logger.error(`Error assigning coach to goal ${goalId}:`, error);
      throw error;
    }
  }

  /**
   * Unassign coach from a goal (owner only)
   */
  async unassignCoach(userId: string, goalId: string) {
    try {
      const goal = await this.prisma.goal.findUnique({
        where: { id: goalId },
      });

      if (!goal) {
        throw new NotFoundException(GOAL_ERROR_MESSAGES.GOAL_NOT_FOUND);
      }

      // Verify ownership
      if (goal.user_id !== userId) {
        throw new ForbiddenException(GOAL_ERROR_MESSAGES.ACCESS_DENIED);
      }

      const updated = await this.prisma.goal.update({
        where: { id: goalId },
        data: { coach_id: null, updated_at: new Date() },
      });

      this.logger.log(`Coach unassigned from goal ${goalId} by user ${userId}`);
      return {
        success: true,
        message: 'Coach unassigned successfully',
        data: { goal: updated },
      };
    } catch (error) {
      this.logger.error(`Error unassigning coach from goal ${goalId}:`, error);
      throw error;
    }
  }

  /**
   * Get all goals assigned to a coach
   */
  async getAssignedGoals(coachId: string) {
    try {
      if (!coachId) {
        throw new BadRequestException(GOAL_ERROR_MESSAGES.COACH_ID_REQUIRED);
      }

      // Verify coach exists and has coach profile
      const coach = await this.prisma.user.findUnique({
        where: { id: coachId },
        include: { coach_profile: true },
      });

      if (!coach || !coach.coach_profile) {
        throw new ForbiddenException(GOAL_ERROR_MESSAGES.COACH_ROLE_REQUIRED);
      }

      const goals = await this.prisma.goal.findMany({
        where: { coach_id: coachId },
        include: {
          progress: { orderBy: { created_at: 'desc' }, take: 5 },
          coach_notes: { orderBy: { created_at: 'desc' }, take: 5 },
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
              email: true,
            },
          },
        },
        orderBy: { updated_at: 'desc' },
      });

      this.logger.log(
        `Fetched ${goals.length} assigned goals for coach ${coachId}`,
      );

      return {
        success: true,
        message: 'Assigned goals fetched successfully',
        data: {
          goals,
          total: goals.length,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error fetching assigned goals for coach ${coachId}:`,
        error,
      );
      throw error;
    }
  }
}
