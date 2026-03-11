import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SazedStorage } from '../../common/lib/Disk/SazedStorage';
import appConfig from '../../config/app.config';

type BadgeCriteria = Record<string, any>;

type BadgeProgress = {
  eligible: boolean;
  current: number;
  target: number;
  percent: number;
};

type BadgeStats = {
  completedBookings: number;
  completedBookingsWithinDays: Record<number, number>;
  completedBookingDistinctDays: Record<number, number>;
  goalsCount: number;
  earnedBadgePoints: number;
  earnedBadgesCount: number;
};

@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  private buildBadgeIconUrl(icon: string) {
    const encodedIcon = encodeURIComponent(icon);
    return SazedStorage.url(
      appConfig().storageUrl.photo + '/' + encodedIcon,
    );
  }

  private serializeBadge<T extends { icon?: string | null }>(badge: T) {
    return {
      ...badge,
      icon_url: badge.icon
        ? this.buildBadgeIconUrl(badge.icon)
        : null,
    };
  }

  private countLegacyGoals(goals: string | null | undefined) {
    if (!goals || !goals.trim()) return 0;

    try {
      const parsed = JSON.parse(goals);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).length;
      if (typeof parsed === 'string') return parsed.trim() ? 1 : 0;
    } catch {
      // Fallback to plain text or comma-separated values.
    }

    const items = goals
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return items.length > 0 ? items.length : 1;
  }

  private extractWindowDays(criteria: unknown): number[] {
    const windows = new Set<number>();

    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      const record = node as BadgeCriteria;
      if (
        typeof record.days === 'number' &&
        Number.isFinite(record.days) &&
        record.days > 0
      ) {
        windows.add(Math.floor(record.days));
      }

      if (Array.isArray(record.conditions)) {
        record.conditions.forEach(walk);
      }
    };

    walk(criteria);
    return [...windows];
  }

  private resolveMetricValue(
    field: string | undefined,
    stats: BadgeStats,
    days?: number,
  ) {
    switch (field) {
      case 'completed_bookings':
        return days && days > 0
          ? stats.completedBookingsWithinDays[days] ?? 0
          : stats.completedBookings;
      case 'completed_booking_days':
        return days && days > 0
          ? stats.completedBookingDistinctDays[days] ?? 0
          : 0;
      case 'goals':
      case 'goals_count':
      case 'user_goals':
        return stats.goalsCount;
      case 'earned_badge_points':
      case 'badge_points':
        return stats.earnedBadgePoints;
      case 'earned_badges':
      case 'earned_badges_count':
        return stats.earnedBadgesCount;
      default:
        return 0;
    }
  }

  private evaluateLeafCriteria(criteria: BadgeCriteria, stats: BadgeStats) {
    const days =
      typeof criteria.days === 'number' && criteria.days > 0
        ? Math.floor(criteria.days)
        : undefined;
    const metricValue = this.resolveMetricValue(criteria.field, stats, days);

    if (criteria.type === 'exists') {
      const current = metricValue > 0 ? 1 : 0;
      return {
        eligible: current === 1,
        current,
        target: 1,
        percent: current === 1 ? 100 : 0,
      };
    }

    const rawTarget = Number(criteria.value ?? 1);
    const target = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 1;
    const current = Math.min(metricValue, target);

    return {
      eligible: metricValue >= target,
      current,
      target,
      percent: Math.min(Math.floor((metricValue / target) * 100), 100),
    };
  }

  private evaluateCriteria(
    criteria: unknown,
    stats: BadgeStats,
  ): BadgeProgress | null {
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
      return null;
    }

    const normalizedCriteria = criteria as BadgeCriteria;

    if (
      Array.isArray(normalizedCriteria.conditions) &&
      normalizedCriteria.conditions.length > 0
    ) {
      const results = normalizedCriteria.conditions
        .map((condition) => this.evaluateCriteria(condition, stats))
        .filter((result): result is BadgeProgress => result !== null);

      if (results.length === 0) return null;

      if (normalizedCriteria.operator === 'any') {
        const eligible = results.some((result) => result.eligible);
        const percent = eligible
          ? 100
          : Math.max(...results.map((result) => result.percent), 0);

        return {
          eligible,
          current: eligible ? 1 : 0,
          target: 1,
          percent,
        };
      }

      const completedConditions = results.filter((result) => result.eligible).length;

      return {
        eligible: completedConditions === results.length,
        current: completedConditions,
        target: results.length,
        percent: Math.floor((completedConditions / results.length) * 100),
      };
    }

    if (!normalizedCriteria.type || !normalizedCriteria.field) {
      return null;
    }

    return this.evaluateLeafCriteria(normalizedCriteria, stats);
  }

  private async buildBadgeStats(userId: string, criteria: unknown) {
    const windows = this.extractWindowDays(criteria);
    const maxWindow = windows.length > 0 ? Math.max(...windows) : 0;

    const [completedBookings, user, userBadges, recentCompletedBookings] =
      await Promise.all([
        this.prisma.booking.count({
          where: { user_id: userId, status: 'COMPLETED' },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            goals: true,
            _count: {
              select: {
                user_goals: true,
              },
            },
          },
        }),
        this.prisma.userBadge.findMany({
          where: { user_id: userId },
          include: {
            badge: {
              select: {
                points: true,
              },
            },
          },
        }),
        maxWindow > 0
          ? this.prisma.booking.findMany({
              where: {
                user_id: userId,
                status: 'COMPLETED',
                appointment_date: {
                  gte: new Date(
                    Date.now() - maxWindow * 24 * 60 * 60 * 1000,
                  ),
                },
              },
              select: {
                appointment_date: true,
              },
            })
          : Promise.resolve([] as { appointment_date: Date }[]),
      ]);

    const completedBookingsWithinDays: Record<number, number> = {};
    const completedBookingDistinctDays: Record<number, number> = {};

    for (const days of windows) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const bookingsInWindow = recentCompletedBookings.filter(
        (booking) => new Date(booking.appointment_date) >= cutoff,
      );

      completedBookingsWithinDays[days] = bookingsInWindow.length;
      completedBookingDistinctDays[days] = new Set(
        bookingsInWindow.map((booking) =>
          new Date(booking.appointment_date).toDateString(),
        ),
      ).size;
    }

    const earnedBadgePoints = userBadges.reduce(
      (total, userBadge) => total + Number(userBadge.badge?.points ?? 0),
      0,
    );

    return {
      completedBookings,
      completedBookingsWithinDays,
      completedBookingDistinctDays,
      goalsCount: Math.max(
        user?._count.user_goals ?? 0,
        this.countLegacyGoals(user?.goals),
      ),
      earnedBadgePoints,
      earnedBadgesCount: userBadges.length,
    };
  }

  private async getBadgeProgress(userId: string, criteria: unknown) {
    const stats = await this.buildBadgeStats(userId, criteria);
    return this.evaluateCriteria(criteria, stats);
  }

  // Return all badges. If userId provided, include earned info and earned_at.
  async getAllBadges(userId?: string) {
    
    const badges = await this.prisma.badge.findMany({
      orderBy: { created_at: 'asc' },
    });

    if (!userId) {
      return {
        success: true,
        message: 'All badges retrieved successfully',
        data: badges.map((b) => this.serializeBadge(b)),
      };
    }

    const userBadges = await this.prisma.userBadge.findMany({
      where: { user_id: userId },
    });
    const map: Record<string, any> = {};
    for (const ub of userBadges) map[ub.badge_id] = ub;

    const badgesWithProgress = badges.map((b) => ({
      ...this.serializeBadge(b),
      earned: !!map[b.id],
      earned_at: map[b.id]?.earned_at ?? null,
    }));

    return {
      success: true,
      message: 'Badges with user progress retrieved successfully',
      data: badgesWithProgress,
    };
  }

  // Return badges earned by a user and summary progress
  async getMyBadges(userId: string) {
    if (!userId) throw new BadRequestException('User ID is required');

    const [allBadges, userBadges] = await Promise.all([
      this.prisma.badge.findMany({ orderBy: { created_at: 'asc' } }),
      this.prisma.userBadge.findMany({
        where: { user_id: userId },
        include: { badge: true },
      }),
    ]);

    const earnedMap: Record<string, any> = {};
    for (const ub of userBadges) earnedMap[ub.badge_id] = ub;

    const completedBookings = await this.prisma.booking.count({
      where: { user_id: userId, status: 'COMPLETED' },
    });

    return {
      success: true,
      message: 'User badges retrieved successfully',
      data: {
        total: allBadges.length,
        earned_count: userBadges.length,
        completed_bookings: completedBookings,
        badges: allBadges.map((b) => ({
          ...this.serializeBadge(b),
          earned: !!earnedMap[b.id],
          earned_at: earnedMap[b.id]?.earned_at ?? null,
        })),
      },
    };
  }

  // Attempt to claim a badge for the user by badge key. Returns whether awarded.
  async claimBadge(userId: string, badgeKey: string) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (!badgeKey) throw new BadRequestException('Badge key is required');

    const badge = await this.prisma.badge.findUnique({
      where: { key: badgeKey },
    });
    if (!badge) throw new NotFoundException('Badge not found');

    const already = await this.prisma.userBadge.findFirst({
      where: { user_id: userId, badge_id: badge.id },
    });
    if (already) throw new BadRequestException('Badge already awarded to this user');

    const progress = await this.getBadgeProgress(userId, badge.criteria);

    if (!progress) {
      throw new BadRequestException('Badge criteria is not configured properly');
    }

    if (!progress.eligible) {
      throw new BadRequestException('You are not eligible for this badge yet');
    }

    const userBadge = await this.prisma.userBadge.create({
      data: { user_id: userId, badge_id: badge.id },
    });

    const serializedBadge = this.serializeBadge(badge);

    return {
      success: true,
      message: 'Badge claimed successfully',
      data: {
        awarded: true,
        badge: serializedBadge,
        progress,
        userBadge: {
          ...userBadge,
          badge: serializedBadge,
        },
      },
    };
  }

  // Return the next badge the user can aim for along with progress info
  async getNextBadge(userId: string) {
    if (!userId) throw new BadRequestException('User ID is required');

    const badges = await this.prisma.badge.findMany({
      orderBy: { created_at: 'asc' },
    });
    const userBadges = await this.prisma.userBadge.findMany({
      where: { user_id: userId },
      include: { badge: true },
    });
    const earnedKeys = new Set(userBadges.map((ub) => ub.badge.key));

    const next = badges.find((b) => !earnedKeys.has(b.key));
    if (!next) {
      return {
        success: true,
        message: 'All badges earned',
        data: {
          next: null,
          all_earned: true,
        },
      };
    }
    const progress = await this.getBadgeProgress(userId, next.criteria);

    return {
      success: true,
      message: 'Next badge retrieved successfully',
      data: {
        next: {
          ...this.serializeBadge(next),
        },
        progress: progress ?? {
          eligible: false,
          current: 0,
          target: 0,
          percent: 0,
        },
      },
    };
  }
}
