import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BookingsCleanupCron {
  private readonly logger = new Logger(BookingsCleanupCron.name);

  constructor(private readonly prisma: PrismaService) {}

  // Automatic cleanup cron job - runs every hour
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredBlockedDaysAndTimeSlots() {
    this.logger.log(
      'Running automatic cleanup of expired blocked days and time slots...',
    );

    try {
      // Get all coaches
      const coaches = await this.prisma.user.findMany({
        where: { type: 'coach' },
        select: { id: true },
      });

      this.logger.log(`Found ${coaches.length} coaches to cleanup`);

      // Cleanup expired blocked days and time slots for each coach
      let cleanedCount = 0;
      for (const coach of coaches) {
        try {
          await this.cleanupForCoach(coach.id);
          cleanedCount++;
        } catch (error) {
          this.logger.warn(`Failed to cleanup for coach ${coach.id}:`, error);
        }
      }

      this.logger.log(
        `Automatic cleanup completed successfully for ${cleanedCount}/${coaches.length} coaches`,
      );
    } catch (error) {
      this.logger.error('Automatic cleanup failed:', error);
    }
  }

  private async cleanupForCoach(coachId: string) {
    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
      select: { id: true },
    });

    if (!coachProfile) return;

    await Promise.all([
      this.cleanupExpiredBlockedDays(coachId),
      this.cleanupExpiredBlockedTimeSlots(coachProfile.id),
    ]);
  }

  private async cleanupExpiredBlockedDays(coachId: string) {
    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
      select: { blocked_days: true, id: true },
    });

    if (!coachProfile?.blocked_days?.length) return;

    const todayIso = new Date().toISOString().slice(0, 10);
    const validDays = coachProfile.blocked_days.filter((d) => d >= todayIso);

    if (validDays.length !== coachProfile.blocked_days.length) {
      await this.prisma.coachProfile.update({
        where: { id: coachProfile.id },
        data: { blocked_days: validDays },
      });
    }
  }

  private async cleanupExpiredBlockedTimeSlots(coachProfileId: string) {
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    const result = await this.prisma.blockedTimeSlot.deleteMany({
      where: {
        coach_profile_id: coachProfileId,
        date: {
          lt: currentDate,
        },
      },
    });

    if (result.count > 0) {
      this.logger.log(
        `Cleaned up ${result.count} expired time slot(s) for coach profile ${coachProfileId}`,
      );
    }
  }
}
