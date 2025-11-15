import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async createGoal(userId: string, payload: any) {
    try {
      if (!userId) return { error: 'User ID is required' };

      const alreadyExists = await this.prisma.goal.findFirst({
        where: { user_id: userId },
      });

      if (alreadyExists) {
        return {
          error:
            'A goal already exists for this user please update the existing goal instead.',
        };
      }

      const data: any = {
        user_id: userId,
        title: payload.title,
        current_value: payload.current_value ?? null,
        target_value: payload.target_value ?? null,
        target_date: payload.target_date ? new Date(payload.target_date) : null,
        frequency_per_week: payload.frequency_per_week ?? null,
        motivation: payload.motivation ?? null,
      };

      // if coach_id provided, validate existence and attach
      if (payload.coach_id) {
        const coach = await this.prisma.user.findUnique({
          where: { id: payload.coach_id },
          include: { coach_profile: true },
        });
        if (!coach) throw new Error('Specified coach not found');
        data.coach_id = payload.coach_id;
      }

      const goal = await this.prisma.goal.create({ data });
      return goal;
    } catch (e) {
      throw e;
    }
  }

  async updateGoal(userId: string, goalId: string, payload: any) {
    const existing = await this.prisma.goal.findUnique({
      where: { id: goalId },
    });
    if (!existing || existing.user_id !== userId)
      throw new NotFoundException('Goal not found');

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: {
        title: payload.title ?? existing.title,
        current_value: payload.current_value ?? existing.current_value,
        target_value: payload.target_value ?? existing.target_value,
        target_date: payload.target_date
          ? new Date(payload.target_date)
          : existing.target_date,
        frequency_per_week:
          payload.frequency_per_week ?? existing.frequency_per_week,
        motivation: payload.motivation ?? existing.motivation,
        updated_at: new Date(),
      },
    });
    return updated;
  }

  async getMyGoals(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { user_id: userId },
      include: {
        progress: { orderBy: { created_at: 'desc' }, take: 1 },
        coach_notes: { orderBy: { created_at: 'desc' }, take: 3 },
      },
    });

    const mapped = goals.map((g) => {
      const latest = g.progress?.[0] ?? null;

      let percent: number | null = null;
      if (typeof g.progress_percent === 'number') {
        percent = g.progress_percent;
      } else {
        const currentVal = parseFloat(
          String(latest?.current_weight ?? g.current_value ?? ''),
        );
        const targetVal = parseFloat(String(g.target_value ?? ''));
        if (!Number.isNaN(currentVal) && !Number.isNaN(targetVal) && targetVal > 0) {
          percent = Math.min(100, Math.floor((currentVal / targetVal) * 100));
        }
      }

      let progress_label: string | null = null;
      if (latest?.current_weight != null && g.target_value != null) {
        progress_label = `${latest.current_weight}/${g.target_value}`;
      } else if (g.current_value != null && g.target_value != null) {
        progress_label = `${g.current_value}/${g.target_value}`;
      }

      return {
        id: g.id,
        title: g.title,
        progress_percent: percent,
        current_value: latest?.current_weight ?? g.current_value,
        target_value: g.target_value,
        target_date: g.target_date,
        frequency_per_week: g.frequency_per_week,
        motivation: g.motivation,
        latest_progress: latest,
        coach_notes: g.coach_notes ?? [],
        progress_label,
      };
    });

    const percents = mapped
      .map((m) => (typeof m.progress_percent === 'number' ? m.progress_percent : null))
      .filter((p) => p !== null) as number[];
    const overall_percent = percents.length
      ? Math.floor(percents.reduce((a, b) => a + b, 0) / percents.length)
      : 0;

    return { overall_percent, goals: mapped };
  }

  async getGoal(goalId: string, userId?: string) {
    const goal = await this.prisma.goal.findUnique({
      where: { id: goalId },
      include: {
        progress: { orderBy: { created_at: 'desc' } },
        coach_notes: true,
      },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    // if userId provided, ensure access (owner or coach) - for now owner only
    if (userId && goal.user_id !== userId)
      throw new NotFoundException('Goal not found');
    return goal;
  }

  async addProgress(userId: string, goalId: string, payload: any) {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal || goal.user_id !== userId)
      throw new NotFoundException('Goal not found');

    const progress = await this.prisma.goalProgress.create({
      data: {
        goal_id: goalId,
        recorded_at: payload.recorded_at
          ? new Date(payload.recorded_at)
          : new Date(),
        previous_weight: payload.previous_weight ?? null,
        current_weight: payload.current_weight ?? null,
        training_duration: payload.training_duration ?? null,
        calories_burned: payload.calories_burned ?? null,
        calories_gained: payload.calories_gained ?? null,
        sets_per_session: payload.sets_per_session ?? null,
        notes: payload.notes ?? null,
      },
    });

    // update aggregated progress_percent if possible (attempt numeric parse)
    try {
      const latest = await this.prisma.goalProgress.findMany({
        where: { goal_id: goalId },
        orderBy: { created_at: 'desc' },
        take: 2,
      });

      const mostRecent = latest[0];
      let percent = goal.progress_percent ?? 0;
      // if both current and target are numeric, compute percentage
      const currentVal = parseFloat(
        String(mostRecent?.current_weight ?? goal.current_value ?? ''),
      );
      const targetVal = parseFloat(String(goal.target_value ?? ''));
      if (
        !Number.isNaN(currentVal) &&
        !Number.isNaN(targetVal) &&
        targetVal > 0
      ) {
        percent = Math.min(100, Math.floor((currentVal / targetVal) * 100));
        await this.prisma.goal.update({
          where: { id: goalId },
          data: { progress_percent: percent },
        });
      }
    } catch (e) {
      // ignore progress calc errors
    }

    return progress;
  }

  async listProgress(goalId: string, page = 1, limit = 20) {
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
    return { items, total, page, limit };
  }

  async addCoachNote(coachId: string, goalId: string, note: string) {
    try {
      if (!coachId) throw new Error('Coach ID is required');

      const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
      if (!goal) throw new NotFoundException('Goal not found');

      const gn = await this.prisma.goalNote.create({
        data: {
          user_id: goal.user_id,
          coach_id: coachId,
          goal_id: goalId,
          note,
        },
      });
      return gn;
    } catch (e) {
      throw e;
    }
  }

  // Assign a coach to a goal (only owner can assign)
  async assignCoach(userId: string, goalId: string, coachId: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.user_id !== userId)
      throw new NotFoundException('Goal not found or access denied');

    // ensure coach exists
    const coach = await this.prisma.user.findUnique({
      where: { id: coachId },
      include: { coach_profile: true },
    });
    if (!coach) throw new NotFoundException('Coach user not found');

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: { coach_id: coachId },
    });
    return updated;
  }

  async unassignCoach(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.user_id !== userId)
      throw new NotFoundException('Goal not found or access denied');

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: { coach_id: null },
    });
    return updated;
  }

  // For coaches: list goals assigned to them
  async getAssignedGoals(coachId: string) {
    try {
      if (!coachId) return { error: 'Coach ID is required' };

      const goals = await this.prisma.goal.findMany({
        where: { coach_id: coachId },
        include: {
          progress: { orderBy: { created_at: 'desc' } },
          coach_notes: true,
          user: { select: { id: true, name: true, avatar: true } },
        },
      });
      return goals;
    } catch (e) {
      return { error: e.message || 'An error occurred' };
    }
  }
}
