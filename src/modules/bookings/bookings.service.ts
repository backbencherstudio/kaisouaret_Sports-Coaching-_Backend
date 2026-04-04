import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { StripePayment } from 'src/common/lib/Payment/stripe/StripePayment';
import appConfig from 'src/config/app.config';
import { SazedStorage } from 'src/common/lib/Disk/SazedStorage';
import {
  NotificationsService,
  NotificationType,
} from 'src/modules/notifications/notifications.service';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async createNotification(
    receiverId: string | undefined,
    text: string,
    notificationType: NotificationType = NotificationType.BOOKING_CREATED,
    senderId?: string,
    entityId?: string,
    variables?: Record<string, any>,
  ) {
    if (!receiverId) return;
    try {
      await this.notificationsService.sendNotification({
        type: notificationType,
        recipient_id: receiverId,
        sender_id: senderId,
        entity_id: entityId,
        variables: {
          notification_text: text,
          ...variables,
        },
      });
    } catch (err) {
      this.logger.warn(`Notification creation failed: ${text}`, err as any);
    }
  }

  private isAppointmentBlockedManualWeekday(
    appointmentIso: string,
    blockedDays: string[] = [],
    blockedTimeSlots: Array<{
      date: Date;
      start_time: string;
      end_time: string;
    }> = [],
  ): boolean {
    if (!appointmentIso) return false;

    const raw = String(appointmentIso).trim();
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return false;

    const isoDate = new Date(
      Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);

    const weekdayIndex = dt.getUTCDay();
    const weekdayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const wname = weekdayNames[weekdayIndex];

    const normalizedBlocked = new Set(
      blockedDays.map((d) => String(d).toLowerCase().trim()),
    );

    // Exact date or weekday match
    if (normalizedBlocked.has(isoDate)) return true;
    if (normalizedBlocked.has(String(weekdayIndex))) return true;
    if (
      normalizedBlocked.has(wname) ||
      normalizedBlocked.has(wname.slice(0, 3))
    )
      return true;

    // Check if appointment falls within any blocked time slot range
    // For now, we check if the date matches a blocked slot date
    // In a full implementation, you'd parse start_time/end_time and check if appointment time falls within the range
    for (const slot of blockedTimeSlots) {
      const slotDateIso = new Date(slot.date).toISOString().slice(0, 10);
      if (slotDateIso === isoDate) {
        // Date matches - for basic blocking, this is sufficient
        // TODO: Add time-range checking if needed (parse start_time/end_time and compare)
        return true;
      }
    }
    return false;
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

  private async cleanupExpiredBlocked(coachId: string) {
    // Get coach profile first
    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
      select: { id: true },
    });

    if (!coachProfile) return;

    // Cleanup both blocked days and time slots
    // Weekend days are NOT cleaned up (they persist)
    await Promise.all([
      this.cleanupExpiredBlockedDays(coachId),
      this.cleanupExpiredBlockedTimeSlots(coachProfile.id),
    ]);
  }

  private async checkTimeConflict(
    coachId: string,
    athleteId: string,
    appointmentDate: Date,
    sessionTime: Date,
    durationMinutes: number,
    excludeBookingId?: string,
  ): Promise<{
    hasConflict: boolean;
    conflictWith?: 'coach' | 'athlete';
    conflictBooking?: any;
  }> {
    // Calculate end time
    const startTime = new Date(sessionTime);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    // Check for overlapping bookings (CONFIRMED or PENDING status)
    const conflictingBookings = await this.prisma.booking.findMany({
      where: {
        id: excludeBookingId ? { not: excludeBookingId } : undefined,
        status: { in: ['CONFIRMED', 'PENDING'] },
        OR: [{ coach_id: coachId }, { user_id: athleteId }],
        appointment_date: appointmentDate,
        session_time: { not: null },
      },
      select: {
        id: true,
        coach_id: true,
        user_id: true,
        session_time: true,
        duration_minutes: true,
        status: true,
      },
    });

    for (const booking of conflictingBookings) {
      if (!booking.session_time) continue;

      const existingStart = new Date(booking.session_time);
      const existingEnd = new Date(
        existingStart.getTime() + (booking.duration_minutes || 60) * 60000,
      );

      // Check for time overlap
      const hasOverlap = startTime < existingEnd && endTime > existingStart;

      if (hasOverlap) {
        const conflictWith = booking.coach_id === coachId ? 'coach' : 'athlete';
        return {
          hasConflict: true,
          conflictWith,
          conflictBooking: booking,
        };
      }
    }

    return { hasConflict: false };
  }

  async setBlockedDays(coachId: string, blockedDates: string[]) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!Array.isArray(blockedDates))
      throw new BadRequestException('blockedDates must be an array');

    // Verify coach exists
    const getCoach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });
    if (!getCoach || getCoach.type !== 'coach')
      throw new NotFoundException('Coach not found');

    // Get coach profile
    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    // Validate and format each date
    const existingDates = new Set(coachProfile.blocked_days ?? []);

    for (const d of blockedDates) {
      const s = String(d).trim();
      if (!s) continue;

      // Validate date format YYYY-MM-DD
      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
      if (!match)
        throw new BadRequestException(
          `Invalid date format: ${s}. Use YYYY-MM-DD`,
        );

      // Format to ISO date
      const year = Number(match[1]);
      const month = Number(match[2]).toString().padStart(2, '0');
      const day = Number(match[3]).toString().padStart(2, '0');
      const isoDate = `${year}-${month}-${day}`;

      // Check if date already blocked
      if (existingDates.has(isoDate)) {
        throw new ConflictException(`Date ${isoDate} is already blocked`);
      }

      // Add to existing dates
      existingDates.add(isoDate);
    }

    // Update blocked days in database
    const updated = await this.prisma.coachProfile.update({
      where: { id: coachProfile.id },
      data: { blocked_days: Array.from(existingDates).sort() },
    });

    // Notify coach about blocked days update
    await this.createNotification(
      coachId,
      `${blockedDates.length} day(s) have been blocked on your calendar.`,
      NotificationType.BOOKING_CREATED,
      coachId,
      coachProfile.id,
    );

    return {
      success: true,
      message: `${blockedDates.length} day(s) blocked successfully`,
      blocked_days: updated.blocked_days,
    };
  }

  async blockedDays(coachId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    // Cleanup expired blocked days before returning
    await this.cleanupExpiredBlockedDays(coachId);

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
      select: { blocked_days: true },
    });

    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    return {
      success: true,
      message: 'Blocked days retrieved successfully',
      blocked_days: coachProfile?.blocked_days || [],
    };
  }

  async blockedTimeSlots(coachId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });

    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    // Cleanup expired blocked time slots before returning
    await this.cleanupExpiredBlockedTimeSlots(coachProfile.id);

    // Fetch all blocked time slots for this coach
    const blockedSlots = await this.prisma.blockedTimeSlot.findMany({
      where: { coach_profile_id: coachProfile.id },
      orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
    });

    return {
      success: true,
      message: 'Blocked time slots retrieved successfully',
      data: blockedSlots,
    };
  }

  async setBlockedTimeSlots(
    coachId: string,
    date: string,
    startTime: string,
    endTime: string,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!date) throw new BadRequestException('Date is required');
    if (!startTime) throw new BadRequestException('Start time is required');
    if (!endTime) throw new BadRequestException('End time is required');

    // Verify coach exists
    const getCoach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });
    if (!getCoach || getCoach.type !== 'coach')
      throw new NotFoundException('Coach not found');

    // Get coach profile
    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    // Validate date format
    const blockDate = new Date(date);
    if (isNaN(blockDate.getTime())) {
      throw new BadRequestException(
        'Invalid date format. Use ISO date format (e.g., 2025-02-15)',
      );
    }

    // Validate time format (simple check for HH:MM format)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]\s?(AM|PM)?$/i;
    if (!timeRegex.test(startTime.trim())) {
      throw new BadRequestException(
        'Invalid start time format. Use format like "7:00 PM" or "14:00"',
      );
    }
    if (!timeRegex.test(endTime.trim())) {
      throw new BadRequestException(
        'Invalid end time format. Use format like "8:00 PM" or "15:00"',
      );
    }

    // Check for duplicate time slot (same date, start, and end time)
    const existingSlot = await this.prisma.blockedTimeSlot.findFirst({
      where: {
        coach_profile_id: coachProfile.id,
        date: blockDate,
        start_time: startTime.trim(),
        end_time: endTime.trim(),
      },
    });

    if (existingSlot) {
      throw new ConflictException(
        `Time slot from ${startTime} to ${endTime} on ${date} is already blocked`,
      );
    }

    // Create the blocked time slot
    const blockedSlot = await this.prisma.blockedTimeSlot.create({
      data: {
        coach_profile_id: coachProfile.id,
        date: blockDate,
        start_time: startTime.trim(),
        end_time: endTime.trim(),
      },
    });

    this.logger.log(
      `Blocked time slot created for coach ${coachId}: ${date} ${startTime} - ${endTime}`,
    );

    // Notify coach about blocked time slot
    await this.createNotification(
      coachId,
      `Time slot from ${startTime} to ${endTime} on ${new Date(date).toLocaleDateString()} has been blocked on your calendar.`,
      NotificationType.BOOKING_CREATED,
      coachId,
      coachProfile.id,
    );

    return {
      success: true,
      message: 'Time slot blocked successfully',
      data: blockedSlot,
    };
  }

  async weekendDays(coachId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const coachProfile = (await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
      select: { weekend_days: true } as any,
    })) as any;

    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    return {
      success: true,
      message: 'Weekend days retrieved successfully',
      weekend_days:
        coachProfile?.weekend_days && coachProfile.weekend_days.length > 0
          ? coachProfile.weekend_days
          : ['sunday'],
    };
  }

  async setWeekendDays(coachId: string, weekendDay: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!weekendDay) throw new BadRequestException('Weekend day is required');

    // Verify coach exists
    const getCoach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });
    if (!getCoach || getCoach.type !== 'coach')
      throw new NotFoundException('Coach not found');

    // Get coach profile
    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    // Valid weekday names
    const validWeekdays = new Set([
      'sunday',
      'sun',
      'monday',
      'mon',
      'tuesday',
      'tue',
      'wednesday',
      'wed',
      'thursday',
      'thu',
      'friday',
      'fri',
      'saturday',
      'sat',
    ]);

    const s = String(weekendDay).trim();
    let normalizedDay: string;

    // Check if it's a weekday name
    const lowerDay = s.toLowerCase();
    if (validWeekdays.has(lowerDay)) {
      // Normalize to full name
      normalizedDay =
        lowerDay === 'sun'
          ? 'sunday'
          : lowerDay === 'mon'
            ? 'monday'
            : lowerDay === 'tue'
              ? 'tuesday'
              : lowerDay === 'wed'
                ? 'wednesday'
                : lowerDay === 'thu'
                  ? 'thursday'
                  : lowerDay === 'fri'
                    ? 'friday'
                    : lowerDay === 'sat'
                      ? 'saturday'
                      : lowerDay;
    } else {
      // Try to parse as date YYYY-MM-DD
      const dt = new Date(s);
      if (isNaN(dt.getTime())) {
        throw new BadRequestException(
          `Invalid format: ${s}. Use weekday name (monday, tuesday, etc.) or date (YYYY-MM-DD)`,
        );
      }
      normalizedDay = new Date(
        Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
      )
        .toISOString()
        .slice(0, 10);
    }

    // Update weekend days in database - REPLACE existing with new single day
    const updated = await this.prisma.coachProfile.update({
      where: { id: coachProfile.id },
      data: { weekend_days: [normalizedDay] } as any,
    } as any);

    // Notify coach about weekend day update
    await this.createNotification(
      coachId,
      `Weekend day has been set to ${normalizedDay} on your calendar.`,
      NotificationType.BOOKING_CREATED,
      coachId,
      coachProfile.id,
    );

    return {
      success: true,
      message: `Weekend day set successfully`,
      weekend_days: (updated as any).weekend_days,
    } as any;
  }

  async getAvailableDays(coachId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    // Cleanup expired blocked days before calculating available days
    await this.cleanupExpiredBlockedDays(coachId);

    const daysOfWeek = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
      select: { blocked_days: true, weekend_days: true },
    });

    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const blockedDays = coachProfile.blocked_days ?? [];
    const weekendDays =
      coachProfile.weekend_days && coachProfile.weekend_days.length > 0
        ? coachProfile.weekend_days
        : ['sunday'];

    // === Calculate 7-day range ===
    const now = new Date();
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(now.getDate() + 7);

    // Filter blocked days that fall within the next 7 days only
    const upcomingBlockedDays = blockedDays.filter((d) => {
      const date = new Date(d);
      return date >= now && date <= sevenDaysLater;
    });

    // Convert blocked dates to weekday names
    const blockedDaysAsNames = upcomingBlockedDays.map((d) => {
      const date = new Date(d);
      return daysOfWeek[date.getUTCDay()];
    });

    // Combine blocked days and weekend days
    const allBlocked = new Set(
      [...blockedDaysAsNames, ...weekendDays].map((d) => d.toLowerCase()),
    );

    // Get next 7 days and exclude blocked/weekend ones
    const next7AvailableDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      const dayName = daysOfWeek[date.getUTCDay()];
      if (!allBlocked.has(dayName)) {
        next7AvailableDays.push(dayName);
      }
    }

    // Save the available days for this 7-day window
    const updated = await this.prisma.coachProfile.update({
      where: { user_id: coachId },
      data: { available_days: next7AvailableDays },
    });

    return {
      success: true,
      message: 'Available days retrieved successfully',
      available_days: updated.available_days,
    };
  }

  // Find coach by date availability
  async findCoachesByDateAvailability(date: string) {
    try {
      if (!date) throw new BadRequestException('Date is required');

      const normalizeDateString = (s: string) => {
        if (!s || typeof s !== 'string') return s;
        let str = s.replace(' ', 'T');
        const d = new Date(str);
        if (!isNaN(d.getTime())) return str;
        const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/);
        if (m) {
          const y = m[1];
          const mm = m[2].padStart(2, '0');
          const dd = m[3].padStart(2, '0');
          const rest = m[4] || '';
          const rebuilt = `${y}-${mm}-${dd}${rest}`;
          const d2 = new Date(rebuilt);
          if (!isNaN(d2.getTime())) return rebuilt;
        }
        const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m2) {
          const y = m2[1];
          const mm = m2[2].padStart(2, '0');
          const dd = m2[3].padStart(2, '0');
          const rebuilt = `${y}-${mm}-${dd}T00:00:00.000Z`;
          const d3 = new Date(rebuilt);
          if (!isNaN(d3.getTime())) return rebuilt;
        }
        return str;
      };

      const normalizedDate = normalizeDateString(date);
      const dt = new Date(normalizedDate);

      if (isNaN(dt.getTime()))
        throw new BadRequestException('Invalid date format');

      const isoDate = new Date(
        Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
      )
        .toISOString()
        .slice(0, 10);

      // Validate date is not in the past
      const today = new Date();
      const todayIso = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        ),
      )
        .toISOString()
        .slice(0, 10);

      if (isoDate < todayIso) {
        throw new BadRequestException(
          'Cannot search for coaches on past dates. Please select a future date.',
        );
      }

      const weekdayNames = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];
      const weekdayName = weekdayNames[dt.getUTCDay()];

      const coaches = await this.prisma.user.findMany({
        where: { type: 'coach', coach_profile: { is: { status: 1 } } },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          phone_number: true,
          bio: true,
          location: true,
          type: true,
          coach_profile: {
            select: {
              id: true,
              primary_specialty: true,
              specialties: true,
              experience_level: true,
              certifications: true,
              hourly_rate: true,
              hourly_currency: true,
              session_duration_minutes: true,
              session_price: true,
              is_verified: true,
              available_days: true,
              weekend_days: true,
              blocked_days: true,
              blocked_time_slots: {
                select: {
                  id: true,
                  date: true,
                  start_time: true,
                  end_time: true,
                },
              },
              avg_rating: true,
              rating_count: true,
              coach_reviews: {
                select: {
                  id: true,
                  rating: true,
                  review_text: true,
                  created_at: true,
                  athlete: {
                    select: {
                      id: true,
                      name: true,
                      avatar: true,
                    },
                  },
                },
                orderBy: { created_at: 'desc' },
                take: 3,
              },
            },
          },
        },
        orderBy: [
          { coach_profile: { is_verified: 'desc' } },
          { coach_profile: { session_price: 'asc' } },
        ],
      });

      const items = coaches
        .filter((coach) => {
          const profile = coach.coach_profile;
          if (!profile) return false;

          const coachWeekendDays =
            profile.weekend_days && profile.weekend_days.length > 0
              ? profile.weekend_days
              : ['sunday'];

          const blocked = this.isAppointmentBlockedManualWeekday(
            normalizedDate,
            [...(profile.blocked_days || []), ...coachWeekendDays],
            profile.blocked_time_slots || [],
          );
          if (blocked) return false;

          const availableDays = profile.available_days || [];
          if (
            availableDays.length > 0 &&
            !availableDays.some((d) => d && d.toLowerCase() === weekdayName)
          ) {
            return false;
          }

          return true;
        })
        .map((coach) => ({
          id: coach.id,
          name: coach.name,
          email: coach.email,
          avatar: coach.avatar,
          type: coach.type,
          coach_profile: coach.coach_profile
            ? {
                id: coach.coach_profile.id,
                specialties: coach.coach_profile.specialties,
                experience_level: coach.coach_profile.experience_level,
                session_duration_minutes:
                  coach.coach_profile.session_duration_minutes,
                session_price: coach.coach_profile.session_price,
                is_verified: coach.coach_profile.is_verified,
                avg_rating: coach.coach_profile.avg_rating,
                rating_count: coach.coach_profile.rating_count,
                coach_reviews: coach.coach_profile.coach_reviews || [],
              }
            : null,
        }));

      if (items.length === 0) {
        return {
          items: [],
          total: 0,
          message: 'No available coaches for this date',
          date: isoDate,
        };
      }

      return {
        items,
        total: items.length,
        date: isoDate,
      };
    } catch (error) {
      console.error('findCoachesByDateAvailability error:', error);
      throw error;
    }
  }

  // book appointment
  async bookAppointment(
    athleteId: string,
    coachId: string,
    date: string,
    sessionPackageId?: string,
  ) {
    try {
      if (!athleteId) throw new BadRequestException('Athlete ID is required');
      const getAthlete = await this.prisma.user.findUnique({
        where: { id: athleteId },
      });
      if (!getAthlete) throw new NotFoundException('Athlete not found');

      const getCoach = await this.prisma.user.findUnique({
        where: { id: coachId },
      });
      if (!getCoach) throw new NotFoundException('Coach not found');
      if (getCoach.type !== 'coach')
        throw new BadRequestException('The target user is not a coach');

      const getCoachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
        include: {
          blocked_time_slots: {
            select: {
              id: true,
              date: true,
              start_time: true,
              end_time: true,
            },
          },
        },
      });
      if (!getCoachProfile)
        throw new NotFoundException('Coach profile not found');

      // Cleanup expired blocked days and time slots
      await this.cleanupExpiredBlocked(coachId);

      // parse and validate date (accept flexible formats like 2025-10-5T10:55:51.710Z)
      const normalizeDateString = (s: string) => {
        if (!s || typeof s !== 'string') return s;

        // trim whitespace
        let str = s.trim();

        // allow space instead of T
        str = str.replace(' ', 'T');

        // try native parse first
        const d = new Date(str);
        if (!isNaN(d.getTime())) return str;

        // match YYYY-M-D[T...]
        const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/);
        if (m) {
          const y = m[1];
          const mm = m[2].padStart(2, '0');
          const dd = m[3].padStart(2, '0');
          const rest = m[4] || '';
          const rebuilt = `${y}-${mm}-${dd}${rest}`;
          const d2 = new Date(rebuilt);
          if (!isNaN(d2.getTime())) return rebuilt;
        }

        // if it's a plain date like YYYY-M-D without time, try adding T00:00:00Z
        const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m2) {
          const y = m2[1];
          const mm = m2[2].padStart(2, '0');
          const dd = m2[3].padStart(2, '0');
          const rebuilt = `${y}-${mm}-${dd}T00:00:00.000Z`;
          const d3 = new Date(rebuilt);
          if (!isNaN(d3.getTime())) return rebuilt;
        }

        return str;
      };

      const normalized = normalizeDateString(date);
      const appointmentDate = new Date(normalized);
      if (isNaN(appointmentDate.getTime()))
        throw new BadRequestException(
          `Invalid date format. Received: "${date}". Expected formats: YYYY-MM-DD or ISO 8601`,
        );

      // Validate appointment date is not in the past
      const now = new Date();
      const appointmentDateOnly = new Date(
        Date.UTC(
          appointmentDate.getUTCFullYear(),
          appointmentDate.getUTCMonth(),
          appointmentDate.getUTCDate(),
        ),
      );
      const todayOnly = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );

      if (appointmentDateOnly < todayOnly) {
        throw new BadRequestException(
          'Cannot book appointments on past dates. Please select a future date.',
        );
      }

      // check coach blocked days/time slots using manual weekday logic
      const blockedDaysArr = getCoachProfile.blocked_days || [];
      const weekendDaysArr =
        (getCoachProfile as any).weekend_days &&
        (getCoachProfile as any).weekend_days.length > 0
          ? (getCoachProfile as any).weekend_days
          : ['sunday'];
      const combinedBlockedDays = [...blockedDaysArr, ...weekendDaysArr];
      const blockedSlotsArr = getCoachProfile.blocked_time_slots || [];

      if (
        this.isAppointmentBlockedManualWeekday(
          normalized,
          combinedBlockedDays,
          blockedSlotsArr,
        )
      ) {
        throw new ConflictException(
          'Selected date/time is blocked by the coach',
        );
      }
      console.log('hit');

      // prevent duplicate exact-date bookings for same user/coach/profile
      const existingBooking = await this.prisma.booking.findFirst({
        where: {
          coach_id: coachId,
          coach_profile_id: getCoachProfile.id,
          user_id: athleteId,
          appointment_date: appointmentDate,
        },
      });
      if (existingBooking && existingBooking.status !== 'PENDING') {
        throw new ConflictException(
          `Booking already exists for this coach and date with status ${existingBooking.status}`,
        );
      }

      const isUpdatingPending =
        !!existingBooking && existingBooking.status === 'PENDING';

      // If a sessionPackageId is provided, validate it belongs to this coach
      let sessionPackage = null;
      if (sessionPackageId) {
        sessionPackage = await this.prisma.sessionsPackage.findUnique({
          where: { id: sessionPackageId },
        });
        if (!sessionPackage)
          throw new NotFoundException('Session package not found');
        if (
          sessionPackage.coach_id !== coachId ||
          sessionPackage.coach_profile_id !== getCoachProfile.id
        ) {
          throw new BadRequestException(
            'Session package does not belong to this coach',
          );
        }
      }

      // Generate default title from coach name and appointment date
      const defaultTitle = `Session with ${getCoach.name} on ${appointmentDate.toISOString().slice(0, 10)}`;

      // common booking base data
      const baseData: any = {
        user: { connect: { id: athleteId } },
        coach_profile: { connect: { id: getCoachProfile.id } },
        coach_id: coachId,
        appointment_date: appointmentDate,
        session_time: null,
        duration_minutes: getCoachProfile.session_duration_minutes || 60,
        session_price:
          getCoachProfile.session_price ??
          getCoachProfile.hourly_rate ??
          undefined,
        currency: getCoachProfile.hourly_currency ?? 'USD',
        location: getCoach.location || 'offline',
        notes: '',
        google_map_link: '',
        title: defaultTitle,
      };

      if (!sessionPackage) {
        // create or update booking record (pending payment)
        const booking = isUpdatingPending
          ? await this.prisma.booking.update({
              where: { id: existingBooking!.id },
              data: {
                ...baseData,
                status: 'PENDING',
                // Reset package-related fields when switching to single session.
                sessionPackage: { disconnect: true },
                description: null,
                number_of_sessions: null,
                days_validity: null,
                total_completed_session: 0,
                total_amount: null,
              },
            })
          : await this.prisma.booking.create({ data: baseData });

        // ensure stripe customer
        let customerId = getAthlete.billing_id;
        if (!customerId) {
          try {
            const customer = await StripePayment.createCustomer({
              user_id: getAthlete.id,
              name:
                getAthlete.name ||
                `${getAthlete.first_name || ''} ${getAthlete.last_name || ''}`.trim(),
              email: getAthlete.email,
            });
            customerId = customer.id;
            await this.prisma.user.update({
              where: { id: getAthlete.id },
              data: { billing_id: customerId },
            });
          } catch (err) {
            // ignore customer creation failure; Stripe may allow creating PaymentIntent without customer
            console.error('Failed to create stripe customer', err);
          }
        }

        // If this is a pending booking update, best-effort cancel previous uncaptured payment intent.
        if (isUpdatingPending && booking.payment_transaction_id) {
          const previousTx = await this.prisma.paymentTransaction.findUnique({
            where: { id: booking.payment_transaction_id },
          });
          if (
            previousTx?.reference_number &&
            ['pending', 'authorized', 'confirmed'].includes(
              String(previousTx.status || '').toLowerCase(),
            )
          ) {
            try {
              await StripePayment.cancelPaymentIntent(
                previousTx.reference_number,
              );
              await this.prisma.paymentTransaction.update({
                where: { id: previousTx.id },
                data: { status: 'cancelled' },
              });
            } catch (err) {
              this.logger.warn(
                `Failed to cancel previous payment intent for booking ${booking.id}`,
                err as any,
              );
            }
          }
        }

        // create payment intent
        const amount =
          Number(booking.session_price) || Number(booking.total_amount) || 0;
        console.log('ammount', amount);
        const currency = booking.currency || 'USD';
        const paymentIntent =
          await StripePayment.createManualCapturePaymentIntent({
            amount,
            currency,
            customer_id: customerId,
            metadata: {
              booking_id: booking.id,
              user_id: getAthlete.id,
              type: 'booking',
            },
          });

        // create payment transaction and link to booking
        const tx = await this.prisma.paymentTransaction.create({
          data: {
            user_id: getAthlete.id,
            amount: amount || undefined,
            currency: currency || undefined,
            reference_number: paymentIntent.id,
            status: 'pending',
            type: 'booking',
            provider: 'stripe',
          },
        });

        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { payment_transaction_id: tx.id },
        });

        // notify coach about new/updated booking request
        await this.createNotification(
          coachId,
          `${getAthlete.name || 'An athlete'} ${isUpdatingPending ? 'updated a pending session request' : 'requested a session'} on ${appointmentDate.toISOString().slice(0, 10)}`,
          NotificationType.BOOKING_CREATED,
          athleteId,
          booking.id,
        );

        // notify athlete about pending booking
        await this.createNotification(
          athleteId,
          `Your session ${isUpdatingPending ? 'update' : 'booking'} with ${getCoach.name} on ${appointmentDate.toISOString().slice(0, 10)} is pending payment.`,
          NotificationType.BOOKING_CREATED,
          coachId,
          booking.id,
        );

        return {
          booking,
          clientSecret: paymentIntent.client_secret,
          payment_intent_id: paymentIntent.id,
          updated_pending_booking: isUpdatingPending,
        };
      }

      // session package booking: compute per-session price
      const totalPrice = Number(sessionPackage.total_price) || 0;
      const numberOfSessions = Number(sessionPackage.number_of_sessions) || 1;
      const sessionPrice =
        numberOfSessions > 0 ? totalPrice / numberOfSessions : 0;

      const packageData = {
        ...baseData,
        sessionPackage: { connect: { id: sessionPackage.id } },
        title: sessionPackage.title || defaultTitle,
        description: sessionPackage.description,
        number_of_sessions: numberOfSessions,
        days_validity: sessionPackage.days_validity,
        total_completed_session: 0,
        total_amount: sessionPackage.total_price,
        session_price: sessionPrice,
        currency: sessionPackage.currency ?? baseData.currency,
      };

      // create or update booking record for package (pending payment)
      const booking = isUpdatingPending
        ? await this.prisma.booking.update({
            where: { id: existingBooking!.id },
            data: {
              ...packageData,
              status: 'PENDING',
            },
          })
        : await this.prisma.booking.create({ data: packageData });

      // ensure stripe customer
      let customerId = getAthlete.billing_id;
      if (!customerId) {
        try {
          const customer = await StripePayment.createCustomer({
            user_id: getAthlete.id,
            name:
              getAthlete.name ||
              `${getAthlete.first_name || ''} ${getAthlete.last_name || ''}`.trim(),
            email: getAthlete.email,
          });
          customerId = customer.id;
          await this.prisma.user.update({
            where: { id: getAthlete.id },
            data: { billing_id: customerId },
          });
        } catch (err) {
          console.error('Failed to create stripe customer', err);
        }
      }

      // If this is a pending booking update, best-effort cancel previous uncaptured payment intent.
      if (isUpdatingPending && booking.payment_transaction_id) {
        const previousTx = await this.prisma.paymentTransaction.findUnique({
          where: { id: booking.payment_transaction_id },
        });
        if (
          previousTx?.reference_number &&
          ['pending', 'authorized', 'confirmed'].includes(
            String(previousTx.status || '').toLowerCase(),
          )
        ) {
          try {
            await StripePayment.cancelPaymentIntent(
              previousTx.reference_number,
            );
            await this.prisma.paymentTransaction.update({
              where: { id: previousTx.id },
              data: { status: 'cancelled' },
            });
          } catch (err) {
            this.logger.warn(
              `Failed to cancel previous package payment intent for booking ${booking.id}`,
              err as any,
            );
          }
        }
      }

      // create payment intent for package total
      const amount = Number(booking.total_amount) || 0;
      const currency = booking.currency || 'USD';
      const paymentIntent =
        await StripePayment.createManualCapturePaymentIntent({
          amount,
          currency,
          customer_id: customerId,
          metadata: {
            booking_id: booking.id,
            user_id: getAthlete.id,
            package_id: sessionPackage.id,
            type: 'booking',
          },
        });

      const tx = await this.prisma.paymentTransaction.create({
        data: {
          user_id: getAthlete.id,
          amount: amount || undefined,
          currency: currency || undefined,
          reference_number: paymentIntent.id,
          status: 'pending',
          type: 'booking',
          provider: 'stripe',
        },
      });

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { payment_transaction_id: tx.id },
      });

      // notify coach about new/updated booking request
      await this.createNotification(
        coachId,
        `${getAthlete.name || 'An athlete'} ${isUpdatingPending ? 'updated a pending session package request' : 'requested a session package'} on ${appointmentDate.toISOString().slice(0, 10)}`,
        NotificationType.BOOKING_CREATED,
        athleteId,
        booking.id,
      );

      return {
        message: isUpdatingPending
          ? 'Session booking updated (awaiting payment)'
          : 'Session booking created (awaiting payment)',
        booking,
        clientSecret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        updated_pending_booking: isUpdatingPending,
      };
    } catch (error) {
      console.error('bookAppointment error:', error);
      // Re-throw HTTP exceptions as-is
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      // Wrap unknown errors
      throw new BadRequestException(
        error && (error as any).message
          ? (error as any).message
          : 'Failed to book appointment',
      );
    }
  }

  async getAthleteBookings(
    athleteId: string,
    page: number = 1,
    limit: number = 10,
    status?: string,
  ) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');

    const normalizedStatus = status?.trim().toUpperCase();
    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];

    if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
      throw new BadRequestException(
        `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`,
      );
    }

    // Validate pagination parameters
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const bookingWhere: any = {
      user_id: athleteId,
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
    };

    // Get total count
    const totalCount = await this.prisma.booking.count({
      where: bookingWhere,
    });

    const bookings = await this.prisma.booking.findMany({
      where: bookingWhere,
      select: {
        id: true,
        coach_id: true,
        appointment_date: true,
        status: true,
        validation_token: true,
        token_expires_at: true,
        title: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        number_of_members: true,
        session_price: true,
        total_amount: true,
        currency: true,
        coach_profile: {
          select: {
            id: true,
            status: true,
            primary_specialty: true,
            specialties: true,
            experience_level: true,
            certifications: true,
            hourly_rate: true,
            hourly_currency: true,
            session_duration_minutes: true,
            session_price: true,
            avg_rating: true,
            rating_count: true,
          },
        },
      },
      orderBy: { appointment_date: 'desc' },
      skip,
      take: limitNum,
    });

    const coachIds = Array.from(new Set(bookings.map((b) => b.coach_id)));
    const coachUsers =
      coachIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: coachIds } },
            select: {
              id: true,
              name: true,
              avatar: true,
              type: true,
            },
          })
        : [];

    const coachMap: Record<string, any> = {};
    for (const coach of coachUsers) coachMap[coach.id] = coach;

    const items = bookings.map((booking) => ({
      id: booking.id,
      appointment_date: booking.appointment_date,
      status: booking.status,
      validation_token: booking.validation_token,
      token_expires_at: booking.token_expires_at,
      title: booking.title,
      session_time: booking.session_time,
      session_time_display: booking.session_time_display,
      duration_minutes: booking.duration_minutes,
      number_of_members: booking.number_of_members,
      session_price: booking.session_price,
      total_amount: booking.total_amount,
      currency: booking.currency,
      coach: {
        user: coachMap[booking.coach_id] || null,
        profile: booking.coach_profile,
      },
    }));

    if (!bookings || bookings.length === 0) {
      return {
        items: [],
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum),
          hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
          hasPrevPage: pageNum > 1,
        },
        message:
          totalCount === 0
            ? 'No bookings found for this athlete'
            : 'No more bookings',
      };
    }

    return {
      items,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
        hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
        hasPrevPage: pageNum > 1,
      },
    };
  }

  async getBookingToken(athleteId: string, bookingId: string) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, user_id: athleteId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (!booking.validation_token)
      throw new BadRequestException('No validation token available');

    const now = new Date();
    if (booking.token_expires_at && new Date(booking.token_expires_at) < now)
      throw new BadRequestException('Validation token has expired');

    return {
      message: 'Booking token retrieved successfully',
      validation_token: booking.validation_token,
      expires_at: booking.token_expires_at,
    };
  }

  async getAthleteBookingsByDate(
    athleteId: string,
    date: string,
    status?: string,
  ) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');

    const normalizedStatus = status?.trim().toUpperCase();
    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];

    if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
      throw new BadRequestException(
        `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`,
      );
    }

    // parse incoming date (accept flexible formats) and query by day range
    const normalizeDateString = (s: string) => {
      if (!s || typeof s !== 'string') return s;
      let str = s.replace(' ', 'T');
      const d = new Date(str);
      if (!isNaN(d.getTime())) return str;
      const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/);
      if (m) {
        const y = m[1];
        const mm = m[2].padStart(2, '0');
        const dd = m[3].padStart(2, '0');
        const rest = m[4] || '';
        const rebuilt = `${y}-${mm}-${dd}${rest}`;
        const d2 = new Date(rebuilt);
        if (!isNaN(d2.getTime())) return rebuilt;
      }
      const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m2) {
        const y = m2[1];
        const mm = m2[2].padStart(2, '0');
        const dd = m2[3].padStart(2, '0');
        const rebuilt = `${y}-${mm}-${dd}T00:00:00.000Z`;
        const d3 = new Date(rebuilt);
        if (!isNaN(d3.getTime())) return rebuilt;
      }
      return str;
    };

    const start = new Date(normalizeDateString(date));
    if (isNaN(start.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const bookings = await this.prisma.booking.findMany({
      where: {
        user_id: athleteId,
        ...(normalizedStatus ? { status: normalizedStatus as any } : {}),
        appointment_date: { gte: start, lt: end },
      },
      select: {
        id: true,
        coach_id: true,
        appointment_date: true,
        status: true,
        validation_token: true,
        token_expires_at: true,
        title: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        number_of_members: true,
        session_price: true,
        total_amount: true,
        currency: true,
        coach_profile: {
          select: {
            id: true,
            status: true,
            primary_specialty: true,
            specialties: true,
            experience_level: true,
            certifications: true,
            hourly_rate: true,
            hourly_currency: true,
            session_duration_minutes: true,
            session_price: true,
            avg_rating: true,
            rating_count: true,
          },
        },
      },
      orderBy: { appointment_date: 'asc' },
    });

    const coachIds = Array.from(new Set(bookings.map((b) => b.coach_id)));
    const coachUsers =
      coachIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: coachIds } },
            select: {
              id: true,
              name: true,
              avatar: true,
              type: true,
            },
          })
        : [];

    const coachMap: Record<string, any> = {};
    for (const coach of coachUsers) coachMap[coach.id] = coach;

    const items = bookings.map((booking) => ({
      id: booking.id,
      appointment_date: booking.appointment_date,
      status: booking.status,
      validation_token: booking.validation_token,
      token_expires_at: booking.token_expires_at,
      title: booking.title,
      session_time: booking.session_time,
      session_time_display: booking.session_time_display,
      duration_minutes: booking.duration_minutes,
      number_of_members: booking.number_of_members,
      session_price: booking.session_price,
      total_amount: booking.total_amount,
      currency: booking.currency,
      coach: {
        user: coachMap[booking.coach_id] || null,
        profile: booking.coach_profile,
      },
    }));

    if (!bookings || bookings.length === 0) {
      return {
        items: [],
        message: 'No bookings found for this athlete on the specified date',
      };
    }

    return { items, total: items.length };
  }

  async getBookingById(athleteId: string, bookingId: string) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        user_id: athleteId,
      },
      select: {
        id: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        title: true,
        coach_id: true,
        user_id: true,
        coach_profile_id: true,
        appointment_date: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        session_price: true,
        location: true,
        session_package_id: true,
        description: true,
        number_of_members: true,
        number_of_sessions: true,
        days_validity: true,
        total_completed_session: true,
        validation_token: true,
        token_expires_at: true,
        total_amount: true,
        currency: true,
        payment_transaction_id: true,
        custom_offer_payment_transaction_id: true,
        status: true,
        notes: true,
        rating: true,
        feedback: true,
        google_map_link: true,
        latitude: true,
        longitude: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const coachUser = await this.prisma.user.findUnique({
      where: { id: booking.coach_id },
      select: {
        id: true,
        name: true,
        status: true,
        email: true,
        phone_number: true,
        avatar: true,
        bio: true,
        objectives: true,
        goals: true,
        sports: true,
        age: true,
        location: true,
        type: true,
      },
    });

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { id: booking.coach_profile_id },
      select: {
        id: true,
        status: true,
        primary_specialty: true,
        specialties: true,
        experience_level: true,
        certifications: true,
        hourly_rate: true,
        hourly_currency: true,
        session_duration_minutes: true,
        session_price: true,
        avg_rating: true,
        rating_count: true,
      },
    });

    // Check if user has active subscription
    const now = new Date();
    const activeSubscription = await this.prisma.userSubscription.findFirst({
      where: {
        user_id: athleteId,
        status: 'active',
        current_period_end: { gte: now },
        deleted_at: null,
        plan: { kind: 'ATHLETE' },
      },
    });

    const isPremium = !!activeSubscription;

    // Fetch session progress/goal progress for ALL users (shown in both normal and premium views)
    const sessionProgress = await this.prisma.goalProgress.findMany({
      where: {
        goal: {
          user_id: athleteId,
          coach_id: booking.coach_id,
        },
      },
      select: {
        id: true,
        recorded_at: true,
        previous_value: true,
        current_value: true,
        session_duration_minutes: true,
        performance_metric_1: true,
        performance_metric_2: true,
        performance_metric_3: true,
        goal: {
          select: {
            id: true,
            title: true,
            progress_percent: true,
          },
        },
      },
      orderBy: { recorded_at: 'desc' },
      take: 1,
    });

    // Base response for all users
    let response: any = {
      ...booking,
      coach: {
        user: coachUser,
        profile: coachProfile,
      },
      sessionProgress:
        sessionProgress && sessionProgress.length > 0
          ? sessionProgress[0]
          : null,
      isPremium,
    };

    // Only videos are gated by subscription; other athlete features stay free
    const [coachNotes, onDemandTips, userBadges, miniLessons] =
      await Promise.all([
        this.prisma.goalNote.findMany({
          where: {
            user_id: athleteId,
            coach_id: booking.coach_id,
          },
          select: {
            id: true,
            note: true,
            created_at: true,
            goal: {
              select: {
                id: true,
                title: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
          take: 5,
        }),
        this.prisma.goalNote.findMany({
          where: {
            coach_id: booking.coach_id,
            user_id: athleteId,
          },
          select: {
            id: true,
            note: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
          take: 3,
        }),
        this.prisma.userBadge.findMany({
          where: { user_id: athleteId },
          include: {
            badge: {
              select: {
                id: true,
                key: true,
                title: true,
                description: true,
                points: true,
                icon: true,
              },
            },
          },
          orderBy: { earned_at: 'desc' },
        }),
        isPremium
          ? this.prisma.video.findMany({
              where: {
                coach_id: booking.coach_id,
                is_premium: true,
              },
              select: {
                id: true,
                title: true,
                description: true,
                thumbnail: true,
                duration: true,
                video_url: true,
              },
              take: 3,
            })
          : Promise.resolve([]),
      ]);

    const formatBadgeIconUrl = (icon?: string | null) => {
      if (!icon) return null;

      const normalizedIcon = String(icon).trim();
      if (!normalizedIcon) return null;

      // Keep already absolute URLs or data URLs unchanged.
      if (
        /^(https?:)?\/\//i.test(normalizedIcon) ||
        normalizedIcon.startsWith('data:')
      ) {
        return normalizedIcon;
      }

      const encodedIcon = encodeURIComponent(normalizedIcon);

      // Use storage url builder to keep output consistent with badge/admin modules.
      try {
        return SazedStorage.url(
          `${appConfig().storageUrl.photo}/${encodedIcon}`,
        );
      } catch {
        // Fallback to env-based URL assembly if storage config is unavailable.
      }

      const assetsBaseUrl = (process.env.ASSETS_BASE_URL || '')
        .trim()
        .replace(/\/+$/, '');
      const iconPath = normalizedIcon.replace(/^\/+/, '');

      return assetsBaseUrl ? `${assetsBaseUrl}/${iconPath}` : iconPath;
    };

    response = {
      ...response,
      premiumFeatures: {
        miniLessons: miniLessons || [],
        coachNotes: coachNotes || [],
        onDemandTips: onDemandTips || [],
        badgesAndRewards:
          userBadges.map((ub) => {
            const badgeIconUrl = formatBadgeIconUrl(ub.badge?.icon);

            return {
              id: ub.id,
              earnedAt: ub.earned_at,
              badge: ub.badge ? { ...ub.badge, icon: badgeIconUrl } : null,
              progress: ub.progress,
            };
          }) || [],
      },
    };

    return {
      success: true,
      message: 'Booking retrieved successfully',
      booking: response,
    };
  }

  // async getSessionDetails(athleteId: string) {

  // coach bookings

  async getCoachBookings(
    coachId: string,
    page: number = 1,
    limit: number = 10,
    status?: string,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const normalizedStatus = status?.trim().toUpperCase();
    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];

    if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
      throw new BadRequestException(
        `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`,
      );
    }

    // Validate pagination parameters
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) {
      console.error(
        `getCoachBookings: coach profile not found for coachId=${coachId}`,
        { coachId },
      );
      throw new NotFoundException('Coach profile not found');
    }

    const bookingWhere: any = {
      coach_id: coachId,
      coach_profile_id: coachProfile.id,
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
    };

    // Get total count
    const totalCount = await this.prisma.booking.count({
      where: bookingWhere,
    });

    // Get paginated bookings
    const bookings = await this.prisma.booking.findMany({
      where: bookingWhere,
      select: {
        id: true,
        appointment_date: true,
        status: true,
        title: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        number_of_members: true,
        session_price: true,
        total_amount: true,
        currency: true,
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
            type: true,
          },
        },
      },
      orderBy: { appointment_date: 'desc' },
      skip,
      take: limitNum,
    });

    if (!bookings || bookings.length === 0) {
      return {
        items: [],
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum),
          hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
          hasPrevPage: pageNum > 1,
        },
        message:
          totalCount === 0
            ? 'No bookings found for this coach'
            : 'No more bookings',
      };
    }

    return {
      items: bookings,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
        hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
        hasPrevPage: pageNum > 1,
      },
    };
  }

  async getCoachBookingsByDate(coachId: string, date: string, status?: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const normalizedStatus = status?.trim().toUpperCase();
    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];

    if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
      throw new BadRequestException(
        `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`,
      );
    }

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });

    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    // parse incoming date and query by day range (flexible formats)
    const normalizeDateString = (s: string) => {
      if (!s || typeof s !== 'string') return s;
      let str = s.replace(' ', 'T');
      const d = new Date(str);
      if (!isNaN(d.getTime())) return str;
      const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/);
      if (m) {
        const y = m[1];
        const mm = m[2].padStart(2, '0');
        const dd = m[3].padStart(2, '0');
        const rest = m[4] || '';
        const rebuilt = `${y}-${mm}-${dd}${rest}`;
        const d2 = new Date(rebuilt);
        if (!isNaN(d2.getTime())) return rebuilt;
      }
      const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m2) {
        const y = m2[1];
        const mm = m2[2].padStart(2, '0');
        const dd = m2[3].padStart(2, '0');
        const rebuilt = `${y}-${mm}-${dd}T00:00:00.000Z`;
        const d3 = new Date(rebuilt);
        if (!isNaN(d3.getTime())) return rebuilt;
      }
      return str;
    };

    const start = new Date(normalizeDateString(date));
    if (isNaN(start.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const bookings = await this.prisma.booking.findMany({
      where: {
        coach_id: coachId,
        coach_profile_id: coachProfile.id,
        ...(normalizedStatus ? { status: normalizedStatus as any } : {}),
        appointment_date: { gte: start, lt: end },
      },
      select: {
        id: true,
        appointment_date: true,
        status: true,
        title: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        number_of_members: true,
        session_price: true,
        total_amount: true,
        currency: true,
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: { appointment_date: 'asc' },
    });

    if (!bookings || bookings.length === 0) {
      return {
        items: [],
        message: 'No bookings found for this coach on the specified date',
      };
    }

    return { items: bookings, total: bookings.length };
  }

  async cancelBooking(coachId: string, bookingId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, coach_id: coachId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status === 'CANCELLED')
      throw new BadRequestException('Booking is already cancelled');

    // Prevent cancellation of completed sessions
    if (booking.status === 'COMPLETED')
      throw new BadRequestException(
        'Cannot cancel a completed session. The session has already been finished.',
      );

    // Check if payment has already been transferred to coach
    if (booking.payment_transaction_id) {
      const paymentTx = await this.prisma.paymentTransaction.findUnique({
        where: { id: booking.payment_transaction_id },
      });

      if (paymentTx && paymentTx.status === 'completed') {
        throw new BadRequestException(
          'Cannot cancel this booking. Payment has already been transferred to the coach account. Please contact support for refund assistance.',
        );
      }
    }

    // Update booking status to cancelled
    const updatedBooking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED' },
    });

    let paymentAction = 'none';
    let paymentMessage = '';

    // Handle payment cancellation (only for pending/authorized payments)
    if (booking.payment_transaction_id) {
      const paymentTx = await this.prisma.paymentTransaction.findUnique({
        where: { id: booking.payment_transaction_id },
      });

      if (paymentTx && paymentTx.reference_number) {
        try {
          // Release held payment (authorized but not captured)
          if (
            paymentTx.status === 'pending' ||
            paymentTx.status === 'authorized' ||
            paymentTx.status === 'confirmed'
          ) {
            // Release the held payment (cancel the payment intent)
            await StripePayment.cancelPaymentIntent(paymentTx.reference_number);

            await this.prisma.paymentTransaction.update({
              where: { id: paymentTx.id },
              data: { status: 'cancelled' },
            });

            paymentAction = 'released';
            paymentMessage =
              'Payment hold released. Funds will be available in your account shortly.';

            this.logger.log(
              `Payment hold released for booking ${bookingId}, payment intent: ${paymentTx.reference_number}`,
            );
          }
        } catch (err) {
          this.logger.error(
            `Failed to process payment cancellation for booking ${bookingId}`,
            err,
          );
          // Continue with cancellation even if payment reversal fails
          paymentMessage =
            'Booking cancelled. Payment reversal is being processed separately.';
        }
      }
    }

    // Notify athlete about cancellation and payment status
    if (booking.user?.id) {
      const notificationText = paymentMessage
        ? `Your booking on ${booking.appointment_date.toISOString().slice(0, 10)} has been cancelled by the coach. ${paymentMessage}`
        : `Your booking on ${booking.appointment_date.toISOString().slice(0, 10)} has been cancelled by the coach.`;

      await this.createNotification(
        booking.user.id,
        notificationText,
        NotificationType.BOOKING_CANCELLED,
        coachId,
        booking.id,
      );
    }

    return {
      success: true,
      message: 'Booking cancelled successfully',
      booking: updatedBooking,
      paymentStatus: paymentAction,
      paymentMessage,
    };
  }

  async getCancelledBookings(userId: string) {
    if (!userId) throw new BadRequestException('User ID is required');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Coach view: return cancelled bookings where they are the coach
    if (user.type === 'coach') {
      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: userId },
      });
      if (!coachProfile) {
        console.error(
          `getCancelledBookings: coach profile not found for userId=${userId}`,
          { userId },
        );
        throw new NotFoundException('Coach profile not found');
      }

      const cancelledBookings = await this.prisma.booking.findMany({
        where: {
          coach_id: userId,
          coach_profile_id: coachProfile.id,
          status: 'CANCELLED',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              status: true,
              email: true,
              avatar: true,
              sports: true,
            },
          },
          sessionPackage: {
            select: {
              id: true,
              title: true,
              description: true,
              number_of_sessions: true,
              days_validity: true,
              total_price: true,
              currency: true,
            },
          },
        },
        orderBy: { appointment_date: 'desc' },
      });

      return {
        items: cancelledBookings || [],
        total: cancelledBookings?.length || 0,
      };
    }

    // Athlete view: return cancelled bookings for this athlete, include coach info
    const bookings = await this.prisma.booking.findMany({
      where: { user_id: userId, status: 'CANCELLED' },
      include: {
        coach_profile: {
          select: {
            id: true,
            status: true,
            primary_specialty: true,
            specialties: true,
            experience_level: true,
            certifications: true,
            hourly_rate: true,
            hourly_currency: true,
            session_duration_minutes: true,
            session_price: true,
            avg_rating: true,
            rating_count: true,
          },
        },
        sessionPackage: {
          select: {
            id: true,
            title: true,
            description: true,
            number_of_sessions: true,
            days_validity: true,
            total_price: true,
            currency: true,
          },
        },
      },
      orderBy: { appointment_date: 'desc' },
    });

    // batch fetch coach user data
    const coachIds = Array.from(new Set(bookings.map((b) => b.coach_id)));
    const coachUsers =
      coachIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: coachIds } },
            select: {
              id: true,
              name: true,
              status: true,
              email: true,
              phone_number: true,
              avatar: true,
              bio: true,
              objectives: true,
              goals: true,
              sports: true,
              age: true,
              location: true,
              type: true,
            },
          })
        : [];

    const coachMap: Record<string, any> = {};
    for (const u of coachUsers) coachMap[u.id] = u;

    const results = bookings.map((b) => ({
      ...b,
      coach: {
        user: coachMap[b.coach_id] || null,
        profile: b.coach_profile,
      },
    }));

    return { items: results, total: results.length };
  }

  async getUpcomingBookings(userId: string) {
    if (!userId) throw new BadRequestException('User ID is required');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();

    if (user.type === 'coach') {
      // coach view: include athlete (user) details
      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: userId },
      });
      if (!coachProfile) {
        // Log context to help debug why a coach has no profile
        console.error(
          `getUpcomingBookings: coach profile not found for userId=${userId}`,
          {
            userId,
            userType: user.type,
          },
        );
        // Return empty list so frontend can handle gracefully instead of an error object
        return [] as any;
      }

      const bookings = await this.prisma.booking.findMany({
        where: {
          coach_id: userId,
          coach_profile_id: coachProfile.id,
          appointment_date: { gte: now },
        },
        select: {
          id: true,
          appointment_date: true,
          session_time: true,
          session_time_display: true,
          duration_minutes: true,
          number_of_members: true,
          session_price: true,
          total_amount: true,
          currency: true,
          location: true,
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
              type: true,
            },
          },
        },
        orderBy: { appointment_date: 'asc' },
      });

      return bookings;
    }

    // athlete view: include coach profile and coach user info
    const bookings = await this.prisma.booking.findMany({
      where: {
        user_id: userId,
        appointment_date: { gte: now },
      },
      select: {
        id: true,
        coach_id: true,
        appointment_date: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        number_of_members: true,
        session_price: true,
        total_amount: true,
        currency: true,
        location: true,
        coach_profile: {
          select: {
            id: true,
            primary_specialty: true,
            specialties: true,
            session_duration_minutes: true,
            session_price: true,
            hourly_currency: true,
            avg_rating: true,
            rating_count: true,
          },
        },
      },
      orderBy: { appointment_date: 'asc' },
    });

    // fetch coach user details in batch (minimal for card)
    const coachIds = Array.from(new Set(bookings.map((b) => b.coach_id)));
    const coachUsers = await this.prisma.user.findMany({
      where: { id: { in: coachIds } },
      select: {
        id: true,
        name: true,
        avatar: true,
        type: true,
      },
    });
    const coachMap: Record<string, any> = {};
    for (const u of coachUsers) coachMap[u.id] = u;

    const results = bookings.map((b) => ({
      id: b.id,
      appointment_date: b.appointment_date,
      session_time: b.session_time,
      session_time_display: b.session_time_display,
      duration_minutes: b.duration_minutes,
      session_price: b.session_price,
      currency: b.currency,
      location: b.location,
      coach: {
        user: coachMap[b.coach_id] || null,
        profile: b.coach_profile,
      },
    }));

    return results;
  }

  async getNextUpcomingSession(userId: string) {
    if (!userId) throw new BadRequestException('User ID is required');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();

    if (user.type === 'coach') {
      // For coach return next session where they are the coach
      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: userId },
      });
      if (!coachProfile) throw new NotFoundException('Coach profile not found');

      const next = await this.prisma.booking.findFirst({
        where: {
          coach_id: userId,
          coach_profile_id: coachProfile.id,
          appointment_date: { gte: now },
        },
        select: {
          id: true,
          appointment_date: true,
          session_time: true,
          session_time_display: true,
          duration_minutes: true,
          number_of_members: true,
          session_price: true,
          total_amount: true,
          currency: true,
          location: true,
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
              type: true,
              bio: true,
            },
          },
        },
        orderBy: { appointment_date: 'asc' },
      });

      if (!next) return { message: 'No upcoming session' };
      return next;
    }

    // Athlete view: next session where they are the user
    const nextBooking = await this.prisma.booking.findFirst({
      where: { user_id: userId, appointment_date: { gte: now } },
      select: {
        id: true,
        coach_id: true,
        appointment_date: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        number_of_members: true,
        session_price: true,
        total_amount: true,
        currency: true,
        location: true,
        coach_profile: {
          select: {
            id: true,
            primary_specialty: true,
            specialties: true,
            session_duration_minutes: true,
            session_price: true,
            hourly_currency: true,
            avg_rating: true,
            rating_count: true,
          },
        },
      },
      orderBy: { appointment_date: 'asc' },
    });

    if (!nextBooking) return { message: 'No upcoming session' };

    // attach coach user info
    const coachUser = await this.prisma.user.findUnique({
      where: { id: nextBooking.coach_id },
      select: {
        id: true,
        name: true,
        avatar: true,
        type: true,
        bio: true,
      },
    });

    return {
      id: nextBooking.id,
      appointment_date: nextBooking.appointment_date,
      session_time: nextBooking.session_time,
      session_time_display: nextBooking.session_time_display,
      duration_minutes: nextBooking.duration_minutes,
      session_price: nextBooking.session_price,
      currency: nextBooking.currency,
      location: nextBooking.location,
      coach: {
        user: coachUser,
        profile: nextBooking.coach_profile,
      },
    };
  }

  async getBookingByIdForCoach(coachId: string, bookingId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        coach_id: coachId,
        coach_profile_id: coachProfile.id,
      },
      select: {
        id: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        title: true,
        coach_id: true,
        user_id: true,
        coach_profile_id: true,
        appointment_date: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        session_price: true,
        location: true,
        session_package_id: true,
        description: true,
        number_of_members: true,
        number_of_sessions: true,
        days_validity: true,
        total_completed_session: true,
        total_amount: true,
        currency: true,
        payment_transaction_id: true,
        custom_offer_payment_transaction_id: true,
        status: true,
        notes: true,
        rating: true,
        feedback: true,
        google_map_link: true,
        latitude: true,
        longitude: true,
        // Explicitly exclude validation_token and token_expires_at from coach view
        user: {
          select: {
            id: true,
            name: true,
            status: true,
            email: true,
            phone_number: true,
            avatar: true,
            bio: true,
            objectives: true,
            goals: true,
            sports: true,
            age: true,
            location: true,
            type: true,
          },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    return booking; // For coach view we intentionally return athlete (user) details and avoid returning coach_profile (self) and validation_token to the response
  }

  async getSessionDetails(userId: string, bookingId: string) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    // Determine user type and fetch core data
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { type: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const isCoach = user.type === 'coach';

    // Fetch booking with basic info based on user type
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...(isCoach ? { coach_id: userId } : { user_id: userId }),
      },
      include: {
        sessionPackage: {
          select: {
            id: true,
            title: true,
            description: true,
            number_of_sessions: true,
            days_validity: true,
            total_price: true,
            currency: true,
          },
        },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    // For coach view: fetch athlete details
    // For athlete view: fetch coach details
    let otherUser = null;
    if (isCoach) {
      // Coach view: get athlete details
      otherUser = await this.prisma.user.findUnique({
        where: { id: booking.user_id },
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          location: true,
          phone_number: true,
          type: true,
          sports: true,
          goals: true,
          objectives: true,
        },
      });
    } else {
      // Athlete view: get coach details
      otherUser = await this.prisma.user.findUnique({
        where: { id: booking.coach_id },
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          location: true,
          phone_number: true,
          type: true,
        },
      });
    }

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { id: booking.coach_profile_id },
      select: {
        id: true,
        primary_specialty: true,
        specialties: true,
        experience_level: true,
        certifications: true,
        hourly_rate: true,
        hourly_currency: true,
        session_duration_minutes: true,
        session_price: true,
        is_verified: true,
        available_days: true,
        weekend_days: true,
        blocked_days: true,
        blocked_time_slots: true,
        latitude: true,
        longitude: true,
        avg_rating: true,
        rating_count: true,
      },
    });

    // Fetch coach reviews (testimonials) - only for athlete view
    let reviews = [];
    if (!isCoach) {
      reviews = await this.prisma.coachReview.findMany({
        where: { coach_id: booking.coach_id },
        select: {
          id: true,
          rating: true,
          review_text: true,
          created_at: true,
          athlete: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
    }

    // Fetch session progress - different based on user type
    let sessionProgress = null;
    if (isCoach) {
      // Coach view: show athlete's progress
      const progress = await this.prisma.goalProgress.findMany({
        where: {
          goal: {
            user_id: booking.user_id,
            coach_id: userId,
          },
        },
        select: {
          id: true,
          recorded_at: true,
          previous_value: true,
          current_value: true,
          session_duration_minutes: true,
          performance_metric_1: true,
          performance_metric_2: true,
          performance_metric_3: true,
          goal: {
            select: {
              id: true,
              title: true,
              progress_percent: true,
            },
          },
        },
        orderBy: { recorded_at: 'desc' },
        take: 1,
      });
      sessionProgress = progress && progress.length > 0 ? progress[0] : null;
    } else {
      // Athlete view: show own progress
      const progress = await this.prisma.goalProgress.findMany({
        where: {
          goal: {
            user_id: userId,
            coach_id: booking.coach_id,
          },
        },
        select: {
          id: true,
          recorded_at: true,
          previous_value: true,
          current_value: true,
          session_duration_minutes: true,
          performance_metric_1: true,
          performance_metric_2: true,
          performance_metric_3: true,
          goal: {
            select: {
              id: true,
              title: true,
              progress_percent: true,
            },
          },
        },
        orderBy: { recorded_at: 'desc' },
        take: 1,
      });
      sessionProgress = progress && progress.length > 0 ? progress[0] : null;
    }

    // Check if user has active subscription - only for athlete view
    const now = new Date();
    let isPremium = false;
    if (!isCoach) {
      const activeSubscription = await this.prisma.userSubscription.findFirst({
        where: {
          user_id: userId,
          status: 'active',
          current_period_end: { gte: now },
          deleted_at: null,
          plan: { kind: 'ATHLETE' },
        },
      });
      isPremium = !!activeSubscription;
    }

    const currentBookingTotalSessions =
      booking.number_of_sessions && booking.number_of_sessions > 0
        ? booking.number_of_sessions
        : 1;
    const currentBookingCompletedSessions = Math.min(
      booking.total_completed_session || 0,
      currentBookingTotalSessions,
    );
    const currentBookingPendingSessions = Math.max(
      currentBookingTotalSessions - currentBookingCompletedSessions,
      0,
    );

    const lifetimeCompletedSessionsWithCoach = await this.prisma.booking.count({
      where: {
        coach_id: booking.coach_id,
        user_id: booking.user_id,
        status: 'COMPLETED',
      },
    });

    // Build response based on user type
    let response: any = {
      id: booking.id,
      title:
        booking.title || coachProfile?.primary_specialty || 'Coaching Session',
      description: booking.description || otherUser?.bio || '',
      sessionOverview: {
        appointment_date: booking.appointment_date,
        session_time: booking.session_time,
        session_time_display: booking.session_time_display,
        duration_minutes:
          booking.duration_minutes || coachProfile?.session_duration_minutes,
        number_of_members: booking.number_of_members || 1,
        session_price: booking.session_price
          ? Number(booking.session_price)
          : null,
        total_amount: booking.total_amount
          ? Number(booking.total_amount)
          : null,
        currency: booking.currency,
        location: booking.location,
        total_sessions: currentBookingTotalSessions,
        completed_sessions: currentBookingCompletedSessions,
        pending_sessions: currentBookingPendingSessions,
      },
      sessionProgress,
      sessionPackage: booking.sessionPackage || null,
      sessionCount: {
        completed_bookings_with_this_coach_lifetime:
          lifetimeCompletedSessionsWithCoach,
      },
    };

    // Add user-specific data
    if (isCoach) {
      // Coach view: show athlete details
      response.athleteDetail = {
        user: otherUser,
      };
      response.coachProfile = {
        id: coachProfile?.id,
        primary_specialty: coachProfile?.primary_specialty,
        specialties: coachProfile?.specialties,
        experience_level: coachProfile?.experience_level,
        certifications: coachProfile?.certifications,
        is_verified: coachProfile?.is_verified,
        avg_rating: coachProfile?.avg_rating,
        rating_count: coachProfile?.rating_count,
      };

      // Fetch previous session history for this athlete
      const previousSessions = await this.prisma.booking.findMany({
        where: {
          coach_id: userId,
          user_id: booking.user_id,
          status: 'COMPLETED',
          id: { not: bookingId },
        },
        select: {
          id: true,
          appointment_date: true,
          title: true,
          description: true,
          status: true,
        },
        orderBy: { appointment_date: 'desc' },
        take: 10,
      });

      response.previousSessionHistory = previousSessions.map((session) => ({
        id: session.id,
        date: session.appointment_date,
        title: session.title || session.description || 'Session',
        status: session.status,
      }));

      // Fetch athlete's statistics from goal progress
      const athleteStats = await this.prisma.goalProgress.findMany({
        where: {
          goal: {
            user_id: booking.user_id,
            coach_id: userId,
          },
        },
        select: {
          id: true,
          recorded_at: true,
          previous_value: true,
          current_value: true,
          session_duration_minutes: true,
          performance_metric_1: true,
          performance_metric_2: true,
          performance_metric_3: true,
          goal: {
            select: {
              id: true,
              title: true,
              target_value: true,
              current_value: true,
            },
          },
        },
        orderBy: { recorded_at: 'desc' },
        take: 20,
      });

      // Calculate statistics
      const latestProgress =
        athleteStats && athleteStats.length > 0 ? athleteStats[0] : null;
      const firstProgress =
        athleteStats && athleteStats.length > 0
          ? athleteStats[athleteStats.length - 1]
          : null;

      response.athleteStatistics = {
        weight: {
          previous: firstProgress?.previous_value || null,
          current: latestProgress?.current_value || null,
          unit: 'kg',
        },
        reps: {
          previous: firstProgress?.performance_metric_1 || null,
          current: latestProgress?.performance_metric_1 || null,
          unit: 'reps',
        },
        duration: {
          previous: firstProgress?.session_duration_minutes || null,
          current: latestProgress?.session_duration_minutes || null,
          unit: 'min',
        },
        calories: {
          average:
            latestProgress?.performance_metric_2 ||
            latestProgress?.performance_metric_3 ||
            null,
          unit: 'kcal',
        },
      };

      // Generate smart insights
      const insights: string[] = [];
      if (latestProgress && firstProgress) {
        // Reps improvement
        const repsDiff =
          (latestProgress.performance_metric_1 || 0) -
          (firstProgress.performance_metric_1 || 0);
        if (repsDiff > 0) {
          insights.push(
            `${otherUser?.name || 'Athlete'} has improved squat reps by +${repsDiff} since last month.`,
          );
        }

        // Weight change
        const weightDiff =
          (firstProgress.current_value || 0) -
          (latestProgress.current_value || 0);
        if (weightDiff !== 0) {
          const goal = latestProgress.goal;
          insights.push(
            `${otherUser?.name || 'Athlete'}'s Weight ${weightDiff > 0 ? 'dropped' : 'increased'} ${Math.abs(weightDiff)}kg over ${Math.ceil(athleteStats.length / 4)} weeks${goal?.target_value ? ` (goal: ${goal.target_value}kg)` : ''}.`,
          );
        }

        // Duration improvement
        const durationDiff =
          (latestProgress.session_duration_minutes || 0) -
          (firstProgress.session_duration_minutes || 0);
        if (durationDiff > 0) {
          insights.push(
            `Plank time increased by +${durationDiff}min since starting program.`,
          );
        }
      }

      response.smartInsights = insights;
    } else {
      // Athlete view: show coach details
      response.coachDetail = {
        user: otherUser,
        profile: {
          id: coachProfile?.id,
          primary_specialty: coachProfile?.primary_specialty,
          specialties: coachProfile?.specialties,
          experience_level: coachProfile?.experience_level,
          certifications: coachProfile?.certifications,
          is_verified: coachProfile?.is_verified,
          avg_rating: coachProfile?.avg_rating,
          rating_count: coachProfile?.rating_count,
        },
      };
      response.upcomingAvailability = {
        available_days: coachProfile?.available_days || [],
        weekend_days: coachProfile?.weekend_days || [],
        blocked_days: coachProfile?.blocked_days || [],
      };
      response.reviewsAndTestimonials = {
        reviews: reviews || [],
        averageRating: coachProfile?.avg_rating || 0,
        totalReviews: coachProfile?.rating_count || 0,
      };
      response.locationDetails = {
        address: booking.location,
        coordinates: {
          latitude: booking.latitude
            ? parseFloat(booking.latitude.toString())
            : null,
          longitude: booking.longitude
            ? parseFloat(booking.longitude.toString())
            : null,
        },
        googleMapLink: booking.google_map_link || null,
      };
      response.isPremium = isPremium;
    }

    // Only videos are gated by subscription; other athlete features stay free
    if (!isCoach) {
      const [coachNotes, onDemandTips, userBadges, miniLessons] =
        await Promise.all([
          this.prisma.goalNote.findMany({
            where: {
              user_id: userId,
              coach_id: booking.coach_id,
            },
            select: {
              id: true,
              note: true,
              created_at: true,
              goal: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
            orderBy: { created_at: 'desc' },
            take: 5,
          }),
          this.prisma.goalNote.findMany({
            where: {
              coach_id: booking.coach_id,
              user_id: userId,
            },
            select: {
              id: true,
              note: true,
              created_at: true,
            },
            orderBy: { created_at: 'desc' },
            take: 3,
          }),
          this.prisma.userBadge.findMany({
            where: { user_id: userId },
            include: {
              badge: {
                select: {
                  id: true,
                  key: true,
                  title: true,
                  description: true,
                  points: true,
                  icon: true,
                },
              },
            },
            orderBy: { earned_at: 'desc' },
          }),
          isPremium
            ? this.prisma.video.findMany({
                where: {
                  coach_id: booking.coach_id,
                  is_premium: true,
                },
                select: {
                  id: true,
                  title: true,
                  description: true,
                  thumbnail: true,
                  duration: true,
                  video_url: true,
                },
                take: 5,
              })
            : Promise.resolve([]),
        ]);

      response.premiumFeatures = {
        miniLessons: miniLessons || [],
        coachNotes: coachNotes || [],
        onDemandTips: onDemandTips || [],
        badgesAndRewards:
          userBadges.map((ub) => ({
            id: ub.id,
            earnedAt: ub.earned_at,
            badge: ub.badge,
            progress: ub.progress,
          })) || [],
      };
    }

    return {
      success: true,
      message: 'Session details retrieved successfully',
      data: response,
    };
  }

  async updateBooking(
    coachId: string,
    bookingId: string,
    updateBookingDto: any,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const booking = await this.prisma.booking.findFirst({
      where: {
        coach_id: coachId,
        coach_profile_id: coachProfile.id,
        id: bookingId,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const existingOffer = await this.prisma.customOffer.findFirst({
      where: {
        booking_id: bookingId,
        status: { in: ['PENDING', 'PAYMENT_PENDING'] },
      },
    });
    if (existingOffer) {
      throw new BadRequestException('A custom offer is already pending');
    }

    // Build update data
    const updateData: any = {};

    // Update basic fields if provided
    if (updateBookingDto.title !== undefined)
      updateData.title = updateBookingDto.title;
    if (updateBookingDto.description !== undefined)
      updateData.description = updateBookingDto.description;
    if (updateBookingDto.location !== undefined)
      updateData.location = updateBookingDto.location;
    if (updateBookingDto.notes !== undefined)
      updateData.notes = updateBookingDto.notes;
    if (updateBookingDto.google_map_link !== undefined)
      updateData.google_map_link = updateBookingDto.google_map_link;
    if (updateBookingDto.status !== undefined)
      updateData.status = updateBookingDto.status;
    if (updateBookingDto.formatted_address !== undefined)
      updateData.formatted_address = updateBookingDto.formatted_address;
    if (updateBookingDto.latitude !== undefined) {
      const latitude = Number(updateBookingDto.latitude);
      if (latitude < -90 || latitude > 90)
        throw new BadRequestException('Latitude must be between -90 and 90');
      updateData.latitude = latitude;
    }
    if (updateBookingDto.longitude !== undefined) {
      const longitude = Number(updateBookingDto.longitude);
      if (longitude < -180 || longitude > 180)
        throw new BadRequestException('Longitude must be between -180 and 180');
      updateData.longitude = longitude;
    }

    // Handle appointment date if provided
    if (updateBookingDto.appointment_date !== undefined) {
      const normalizeDateString = (s: string) => {
        if (!s || typeof s !== 'string') return new Date(s);
        let str = s.replace(' ', 'T');
        const d = new Date(str);
        if (!isNaN(d.getTime())) return d;
        const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/);
        if (m) {
          const y = m[1];
          const mm = m[2].padStart(2, '0');
          const dd = m[3].padStart(2, '0');
          const rest = m[4] || '';
          const rebuilt = `${y}-${mm}-${dd}${rest}`;
          const d2 = new Date(rebuilt);
          if (!isNaN(d2.getTime())) return d2;
        }
        const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m2) {
          const y = m2[1];
          const mm = m2[2].padStart(2, '0');
          const dd = m2[3].padStart(2, '0');
          const rebuilt = `${y}-${mm}-${dd}T00:00:00.000Z`;
          const d3 = new Date(rebuilt);
          if (!isNaN(d3.getTime())) return d3;
        }
        return new Date(s);
      };

      const newDate = normalizeDateString(updateBookingDto.appointment_date);
      if (isNaN(newDate.getTime())) {
        throw new BadRequestException('Invalid appointment date format');
      }

      // Validate date is not in the past
      const now = new Date();
      const newDateOnly = new Date(
        Date.UTC(
          newDate.getUTCFullYear(),
          newDate.getUTCMonth(),
          newDate.getUTCDate(),
        ),
      );
      const todayOnly = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );

      if (newDateOnly < todayOnly) {
        throw new BadRequestException(
          'Cannot update appointment to a past date',
        );
      }

      updateData.appointment_date = newDate;
    }

    // Handle time slot (startTime and endTime)
    if (
      updateBookingDto.startTime !== undefined ||
      updateBookingDto.endTime !== undefined
    ) {
      const startTime = updateBookingDto.startTime?.trim();
      const endTime = updateBookingDto.endTime?.trim();

      if (!startTime || !endTime) {
        throw new BadRequestException(
          'Both startTime and endTime are required',
        );
      }

      // Validate time format
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]\s?(AM|PM)?$/i;
      if (!timeRegex.test(startTime)) {
        throw new BadRequestException(
          'Invalid start time format. Use format like "7:00 PM" or "14:00"',
        );
      }
      if (!timeRegex.test(endTime)) {
        throw new BadRequestException(
          'Invalid end time format. Use format like "8:00 PM" or "15:00"',
        );
      }

      // Calculate duration_minutes from startTime and endTime
      const parseTime = (
        timeStr: string,
      ): { hours: number; minutes: number } => {
        // Handle both "HH:MM" and "HH:MM AM/PM" formats
        const match = timeStr.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)?$/i);
        if (!match) throw new Error('Invalid time format');

        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const period = match[3]?.toUpperCase();

        // Convert 12-hour to 24-hour format if AM/PM provided
        if (period) {
          if (period === 'PM' && hours !== 12) {
            hours += 12;
          } else if (period === 'AM' && hours === 12) {
            hours = 0;
          }
        }

        return { hours, minutes };
      };

      const startTime24 = parseTime(startTime);
      const endTime24 = parseTime(endTime);

      const startTotalMinutes = startTime24.hours * 60 + startTime24.minutes;
      const endTotalMinutes = endTime24.hours * 60 + endTime24.minutes;

      let durationMinutes = endTotalMinutes - startTotalMinutes;
      if (durationMinutes <= 0) {
        throw new BadRequestException('End time must be after start time');
      }

      // Create session_time as ISO-8601 datetime using appointment_date + startTime
      const appointmentDate =
        updateData.appointment_date || booking.appointment_date;
      const sessionDateTime = new Date(appointmentDate);
      sessionDateTime.setUTCHours(startTime24.hours, startTime24.minutes, 0, 0);

      // Check for time conflicts before updating
      const conflict = await this.checkTimeConflict(
        coachId,
        booking.user_id,
        appointmentDate,
        sessionDateTime,
        durationMinutes,
        bookingId, // Exclude current booking
      );

      if (conflict.hasConflict) {
        throw new ConflictException(
          `Time slot conflict: ${conflict.conflictWith === 'coach' ? 'Coach' : 'Athlete'} already has a booking at this time`,
        );
      }

      updateData.session_time = sessionDateTime;

      // Set session_time_display as "startTime - endTime" format
      updateData.session_time_display = `${startTime} - ${endTime}`;

      updateData.duration_minutes = durationMinutes;

      this.logger.log(
        `Booking ${bookingId} time slot updated: ${startTime} - ${endTime} (duration: ${durationMinutes} minutes)`,
      );
    }

    // Update the booking
    const updatedBooking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
    });

    // Notify athlete about booking update with details
    const updatedFields = Object.keys(updateData);
    const changedDetails = updatedFields
      .map((field) => {
        if (field === 'session_time')
          return `time slot to ${updateData[field]}`;
        if (field === 'appointment_date')
          return `date to ${new Date(updateData[field]).toLocaleDateString()}`;
        if (field === 'duration_minutes')
          return `duration to ${updateData[field]} minutes`;
        return field;
      })
      .join(', ');

    await this.createNotification(
      booking.user_id,
      `Your booking has been updated: ${changedDetails}`,
      NotificationType.BOOKING_RESCHEDULED,
      coachId,
      booking.id,
    );

    return {
      success: true,
      message: 'Booking updated successfully',
      data: {
        id: updatedBooking.id,
        appointment_date: updatedBooking.appointment_date,
        session_time: updatedBooking.session_time,
        session_time_display: updatedBooking.session_time_display,
        duration_minutes: updatedBooking.duration_minutes,
        title: updatedBooking.title,
        description: updatedBooking.description,
        notes: updatedBooking.notes,
        status: updatedBooking.status,
        location: updatedBooking.location,
        formatted_address: updatedBooking.formatted_address,
        latitude: updatedBooking.latitude
          ? Number(updatedBooking.latitude)
          : null,
        longitude: updatedBooking.longitude
          ? Number(updatedBooking.longitude)
          : null,
        session_price: updatedBooking.session_price
          ? Number(updatedBooking.session_price)
          : null,
        currency: updatedBooking.currency,
      },
    };
  }

  async sendCustomOffer(
    coachId: string,
    bookingId: string,
    customOfferDto: any,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const booking = await this.prisma.booking.findFirst({
      where: {
        coach_id: coachId,
        coach_profile_id: coachProfile.id,
        id: bookingId,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    // Validate number of members
    const numberOfMembers = Number(customOfferDto.number_of_members);
    if (!numberOfMembers || numberOfMembers < 1) {
      throw new BadRequestException('Number of members must be at least 1');
    }

    // Parse and validate times
    const parseTime = (timeStr: string): { hours: number; minutes: number } => {
      const match = timeStr.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)?$/i);
      if (!match) throw new BadRequestException('Invalid time format');

      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const period = match[3]?.toUpperCase();

      if (period) {
        if (period === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period === 'AM' && hours === 12) {
          hours = 0;
        }
      }

      return { hours, minutes };
    };

    const startTime24 = parseTime(customOfferDto.startTime);
    const endTime24 = parseTime(customOfferDto.endTime);

    const startTotalMinutes = startTime24.hours * 60 + startTime24.minutes;
    const endTotalMinutes = endTime24.hours * 60 + endTime24.minutes;

    let durationMinutes = endTotalMinutes - startTotalMinutes;
    if (durationMinutes <= 0) {
      throw new BadRequestException('End time must be after start time');
    }

    // Parse appointment date
    const normalizeDateString = (s: string) => {
      if (!s || typeof s !== 'string') return new Date(s);
      let str = s.replace(' ', 'T');
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d;
      const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/);
      if (m) {
        const y = m[1];
        const mm = m[2].padStart(2, '0');
        const dd = m[3].padStart(2, '0');
        const rest = m[4] || '';
        const rebuilt = `${y}-${mm}-${dd}${rest}`;
        const d2 = new Date(rebuilt);
        if (!isNaN(d2.getTime())) return d2;
      }
      const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m2) {
        const y = m2[1];
        const mm = m2[2].padStart(2, '0');
        const dd = m2[3].padStart(2, '0');
        const rebuilt = `${y}-${mm}-${dd}T00:00:00.000Z`;
        const d3 = new Date(rebuilt);
        if (!isNaN(d3.getTime())) return d3;
      }
      return new Date(s);
    };

    const newDate = normalizeDateString(customOfferDto.appointment_date);
    if (isNaN(newDate.getTime())) {
      throw new BadRequestException('Invalid appointment date format');
    }

    // Validate date is not in the past
    const now = new Date();
    const newDateOnly = new Date(
      Date.UTC(
        newDate.getUTCFullYear(),
        newDate.getUTCMonth(),
        newDate.getUTCDate(),
      ),
    );
    const todayOnly = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    if (newDateOnly < todayOnly) {
      throw new BadRequestException('Cannot set appointment to a past date');
    }

    // Create session_time
    const sessionDateTime = new Date(newDate);
    sessionDateTime.setUTCHours(startTime24.hours, startTime24.minutes, 0, 0);

    // Check for time conflicts before sending custom offer
    const conflict = await this.checkTimeConflict(
      coachId,
      booking.user_id,
      newDate,
      sessionDateTime,
      durationMinutes,
      bookingId, // Exclude current booking
    );

    if (conflict.hasConflict) {
      throw new ConflictException(
        `Time slot conflict: ${conflict.conflictWith === 'coach' ? 'Coach' : 'Athlete'} already has a booking at this time`,
      );
    }

    // Calculate pricing
    // Base price per session from booking or coach profile
    const basePricePerSession =
      Number(booking.session_price) || Number(coachProfile.session_price) || 55;

    // Total amount = base price per session × number of members
    const totalAmount = basePricePerSession * numberOfMembers;

    // Paid amount (from authorized payment transaction if available)
    let paidAmount = 0;
    if (booking.payment_transaction_id) {
      const tx = await this.prisma.paymentTransaction.findUnique({
        where: { id: booking.payment_transaction_id },
      });
      if (tx && tx.status === 'authorized' && tx.amount) {
        paidAmount = Number(tx.amount);
      }
    }

    // Due amount = total amount - paid amount
    const dueAmount = totalAmount - paidAmount;

    const offer = await this.prisma.customOffer.create({
      data: {
        booking_id: bookingId,
        coach_id: coachId,
        athlete_id: booking.user_id,
        title: customOfferDto.title || booking.title,
        appointment_date: newDate,
        session_time: sessionDateTime,
        session_time_display: `${customOfferDto.startTime} - ${customOfferDto.endTime}`,
        duration_minutes: durationMinutes,
        number_of_members: numberOfMembers,
        session_price: basePricePerSession,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        due_amount: dueAmount > 0 ? dueAmount : 0,
        currency: booking.currency || 'USD',
        status: 'PENDING',
        sent_at: new Date(),
        responded_at: null,
        payment_transaction_id: null,
      },
    });

    // Notify athlete about custom offer
    await this.createNotification(
      booking.user_id,
      `Custom offer received: ${customOfferDto.title || 'Group Session'} for ${numberOfMembers} members. Total: $${totalAmount}`,
      NotificationType.CUSTOM_OFFER_RECEIVED,
      coachId,
      booking.id,
    );

    return {
      success: true,
      message: 'Custom offer sent successfully',
      data: {
        id: offer.id,
        title: offer.title,
        appointment_date: offer.appointment_date,
        session_time: offer.session_time,
        session_time_display: offer.session_time_display,
        duration_minutes: offer.duration_minutes,
        number_of_members: offer.number_of_members,
        pricing: {
          base_price_per_session: basePricePerSession,
          paid_amount: paidAmount,
          due_amount: dueAmount > 0 ? dueAmount : 0,
          total_amount: totalAmount,
          currency: offer.currency || 'USD',
        },
        custom_offer_status: offer.status,
        status: booking.status,
      },
    };
  }

  async validateBookingToken(
    coachId: string,
    bookingId: string,
    token: string,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        coach_profile_id: coachProfile.id,
        coach_id: coachId,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    // Check if all sessions are already completed
    if (
      booking.number_of_sessions &&
      booking.total_completed_session >= booking.number_of_sessions
    ) {
      throw new BadRequestException(
        'All sessions for this booking have been completed',
      );
    }

    // For single-session bookings, check if already completed
    if (!booking.number_of_sessions && booking.status === 'COMPLETED') {
      throw new BadRequestException('This booking has already been validated');
    }

    if (!booking.payment_transaction_id) {
      throw new BadRequestException('Payment transaction not found');
    }

    // Fetch both payment transactions (initial booking + optional custom offer)
    const paymentTx = await this.prisma.paymentTransaction.findUnique({
      where: { id: booking.payment_transaction_id },
    });

    if (!paymentTx?.reference_number) {
      throw new BadRequestException('Payment intent not found');
    }

    // Fetch custom offer payment transaction if exists
    let customOfferTx = null;
    if (booking.custom_offer_payment_transaction_id) {
      customOfferTx = await this.prisma.paymentTransaction.findUnique({
        where: { id: booking.custom_offer_payment_transaction_id },
      });
    }

    const priorTransferFailed =
      paymentTx.transfer_status === 'failed' ||
      (customOfferTx && customOfferTx.transfer_status === 'failed');

    if (!priorTransferFailed) {
      if (!token) throw new BadRequestException('Validation token is required');
      if (!booking.validation_token || !booking.token_expires_at)
        throw new BadRequestException(
          'No validation token available for this booking',
        );
      const now = new Date();
      if (new Date(booking.token_expires_at) < now)
        throw new BadRequestException('Validation token has expired');
      if (booking.validation_token !== token)
        throw new BadRequestException('Invalid validation token');
    } else if (booking.validation_token && token) {
      if (booking.validation_token !== token)
        throw new BadRequestException('Invalid validation token');
    }

    if (!coachProfile.stripe_account_id) {
      throw new BadRequestException(
        'Coach payout account is not connected. Please complete Stripe onboarding.',
      );
    }

    // Verify Stripe account is valid and ready for transfers
    try {
      const account = await StripePayment.getAccountDetails(
        coachProfile.stripe_account_id,
      );

      if (!account.charges_enabled || !account.payouts_enabled) {
        this.logger.warn(
          `Coach Stripe account not fully enabled: charges_enabled=${account.charges_enabled}, payouts_enabled=${account.payouts_enabled}`,
        );
        throw new BadRequestException(
          'Coach payout account is not fully activated. Please complete Stripe verification.',
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to verify coach Stripe account ${coachProfile.stripe_account_id}:`,
        error,
      );
      throw new BadRequestException(
        'Unable to verify coach payout account. Please contact support.',
      );
    }

    // Capture initial payment intent
    const intent = await StripePayment.retrievePaymentIntent(
      paymentTx.reference_number,
    );

    const captured =
      intent.status === 'succeeded'
        ? intent
        : await StripePayment.capturePaymentIntent(paymentTx.reference_number);

    // Capture custom offer payment intent if exists
    let capturedCustomOffer = null;
    if (customOfferTx && customOfferTx.reference_number) {
      const customOfferIntent = await StripePayment.retrievePaymentIntent(
        customOfferTx.reference_number,
      );

      capturedCustomOffer =
        customOfferIntent.status === 'succeeded'
          ? customOfferIntent
          : await StripePayment.capturePaymentIntent(
              customOfferTx.reference_number,
            );
    }

    // Calculate payout: per-session for packages, full amount for single sessions
    let basePayoutAmount = paymentTx.amount ? Number(paymentTx.amount) : 0;
    let customOfferPayoutAmount = 0;

    if (capturedCustomOffer) {
      customOfferPayoutAmount = customOfferTx?.amount
        ? Number(customOfferTx.amount)
        : 0;
    }

    // For package bookings, divide by number of sessions; for single sessions, use full amount
    let payoutAmount = basePayoutAmount;
    let customOfferPayout = customOfferPayoutAmount;

    if (booking.number_of_sessions && booking.number_of_sessions > 0) {
      // Per-session payout for packages
      payoutAmount = basePayoutAmount / booking.number_of_sessions;
      customOfferPayout = customOfferPayoutAmount / booking.number_of_sessions;
    }

    payoutAmount += customOfferPayout;

    const payoutCurrency = paymentTx.currency || booking.currency || 'USD';

    let transferReference: string | undefined;
    let transferStatus: string | undefined;
    let transferError: string | undefined;

    try {
      const logMessage = booking.number_of_sessions
        ? `Creating transfer for coach ${coachProfile.stripe_account_id}: ${payoutAmount} ${payoutCurrency} (Session ${(booking.total_completed_session || 0) + 1}/${booking.number_of_sessions})`
        : `Creating transfer for coach ${coachProfile.stripe_account_id}: ${payoutAmount} ${payoutCurrency}`;

      this.logger.log(logMessage);

      const transfer = await StripePayment.createTransfer(
        coachProfile.stripe_account_id,
        payoutAmount,
        payoutCurrency,
      );
      transferReference = transfer.id;
      transferStatus = 'created';

      this.logger.log(`Transfer created successfully: ${transferReference}`);
    } catch (error) {
      transferStatus = 'failed';
      transferError = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Transfer failed for booking ${bookingId}:`,
        error instanceof Error ? error.stack : error,
      );

      // Log detailed error information
      this.logger.error('Transfer failure details:', {
        coachId,
        stripe_account_id: coachProfile.stripe_account_id,
        payoutAmount,
        payoutCurrency,
        bookingId,
        error: transferError,
      });
    }

    // Determine booking status based on transfer success and booking type
    let finalStatus: 'CONFIRMED' | 'COMPLETED' = 'CONFIRMED';
    let finalCompletedSessions = booking.total_completed_session || 0;

    if (transferStatus === 'created') {
      // Only increment if transfer succeeded
      finalCompletedSessions += 1;

      // Check if this is a package booking or single session
      if (booking.number_of_sessions) {
        // Package booking: only mark COMPLETED when all sessions are done
        finalStatus =
          finalCompletedSessions >= booking.number_of_sessions
            ? 'COMPLETED'
            : 'CONFIRMED';
      } else {
        // Single-session booking: mark COMPLETED after first validation
        finalStatus = 'COMPLETED';
      }
    } else {
      // Transfer failed - keep CONFIRMED
      finalStatus = 'CONFIRMED';
    }

    // Update booking - sessions increment, status conditional on package type
    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: finalStatus,
        validation_token:
          // For package bookings with remaining sessions: generate new token
          transferStatus === 'created' &&
          booking.number_of_sessions &&
          finalCompletedSessions < booking.number_of_sessions
            ? String(Math.floor(100000 + Math.random() * 900000)) // 6-digit token
            : // For all-completed packages or single-session bookings: clear token
              null,
        // Set token expiration 30 days from now (for next session validation)
        token_expires_at:
          transferStatus === 'created' &&
          booking.number_of_sessions &&
          finalCompletedSessions < booking.number_of_sessions
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
            : null,
        total_completed_session: finalCompletedSessions,
      },
    });

    // Update initial payment transaction
    await this.prisma.paymentTransaction.update({
      where: { id: booking.payment_transaction_id },
      data: {
        status: captured.status === 'succeeded' ? 'captured' : captured.status,
        paid_amount: captured.amount_received
          ? captured.amount_received / 100
          : undefined,
        paid_currency: captured.currency,
        raw_status: captured.status,
        transfer_reference: transferReference,
        transfer_status: transferStatus,
      },
    });

    // Update custom offer payment transaction if exists
    if (customOfferTx && capturedCustomOffer) {
      await this.prisma.paymentTransaction.update({
        where: { id: booking.custom_offer_payment_transaction_id! },
        data: {
          status:
            capturedCustomOffer.status === 'succeeded'
              ? 'captured'
              : capturedCustomOffer.status,
          paid_amount: capturedCustomOffer.amount_received
            ? capturedCustomOffer.amount_received / 100
            : undefined,
          paid_currency: capturedCustomOffer.currency,
          raw_status: capturedCustomOffer.status,
          transfer_reference: transferReference,
          transfer_status: transferStatus,
        },
      });
    }

    // Notify based on transfer status
    if (transferStatus === 'created') {
      // Transfer succeeded - session validated
      const isPackage = booking.number_of_sessions;
      const sessionsMessage = isPackage
        ? `Session ${finalCompletedSessions}/${booking.number_of_sessions} completed`
        : 'Session completed';

      const payoutMessage = isPackage
        ? `$${payoutAmount.toFixed(2)} transferred (${payoutAmount.toFixed(2)} × ${booking.number_of_sessions} sessions)`
        : `$${payoutAmount.toFixed(2)} transferred`;

      await this.createNotification(
        booking.user_id,
        `Your ${sessionsMessage}. ${payoutMessage} transferred to coach.`,
        NotificationType.SESSION_COMPLETED,
        coachId,
        booking.id,
      );

      await this.createNotification(
        coachId,
        `${sessionsMessage}. ${payoutMessage} transferred to your connected account.`,
        NotificationType.SESSION_COMPLETED,
        booking.user_id,
        booking.id,
      );
    } else {
      // Transfer failed - payment captured but pending transfer
      await this.createNotification(
        booking.user_id,
        'Your session has been validated. Payment captured successfully.',
        NotificationType.BOOKING_COMPLETED,
        coachId,
        booking.id,
      );

      await this.createNotification(
        coachId,
        'Session validated but payout transfer failed. Support has been notified.',
        NotificationType.BOOKING_COMPLETED,
        booking.user_id,
        booking.id,
      );

      // Notify admin/support about transfer failure
      this.logger.error(
        `CRITICAL: Transfer failed for booking ${bookingId}. Manual intervention required.`,
      );
    }

    // Calculate total payout for all sessions
    const totalPayoutForAllSessions = booking.number_of_sessions
      ? payoutAmount * booking.number_of_sessions
      : payoutAmount;

    return {
      statusCode: transferStatus === 'failed' ? 202 : 201,
      message:
        transferStatus === 'failed'
          ? 'Payment captured successfully, but transfer to coach failed. Booking remains CONFIRMED until transfer succeeds. Support has been notified.'
          : booking.number_of_sessions
            ? `Session ${finalCompletedSessions}/${booking.number_of_sessions} validated. $${payoutAmount.toFixed(2)} transferred. ${finalCompletedSessions >= booking.number_of_sessions ? 'All sessions completed!' : 'More sessions to validate.'}`
            : 'Session validated and marked as COMPLETED. Payout transferred to coach successfully.',
      data: {
        booking: updated,
        transfer_status: transferStatus,
        transfer_error: transferError,
        transfer_reference: transferReference,
        payout_info: {
          payout_per_session: payoutAmount,
          total_payout_for_all_sessions: booking.number_of_sessions
            ? payoutAmount * booking.number_of_sessions
            : payoutAmount,
          currency: payoutCurrency,
          is_package_booking: !!booking.number_of_sessions,
        },
        requires_manual_intervention: transferStatus === 'failed',
        sessions_completed: finalCompletedSessions,
        sessions_remaining: booking.number_of_sessions
          ? booking.number_of_sessions - finalCompletedSessions
          : 0,
      },
    };
  }

  //
  // ------------------------- session package -----------------------
  //
  async createSessionPackage(coachId: string, createSessionPackageDto: any) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const getCoach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });

    if (!getCoach || getCoach.type !== 'coach') {
      throw new NotFoundException('Coach not found');
    }

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const sessionPackage = await this.prisma.sessionsPackage.create({
      data: {
        coach_profile_id: coachProfile.id,
        coach_id: coachId,
        title: createSessionPackageDto.title,
        description: createSessionPackageDto.description,
        number_of_sessions: createSessionPackageDto.number_of_sessions,
        days_validity: createSessionPackageDto.days_validity,
        total_price: createSessionPackageDto.total_price,
        currency: createSessionPackageDto.currency,
      },
    });

    // notify coach about new package creation
    await this.createNotification(
      coachId,
      `You have successfully created a new session package: ${createSessionPackageDto.title}`,
      NotificationType.SESSION_PACKAGE_PURCHASED,
      coachId,
      sessionPackage.id,
    );

    return {
      success: true,
      message: 'Session package created successfully',
      sessionPackage,
    };
  }

  async getSessionPackages(coachId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: {
        user_id: coachId,
      },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const packages = await this.prisma.sessionsPackage.findMany({
      where: { coach_id: coachId, coach_profile_id: coachProfile.id },
      select: {
        id: true,
        title: true,
        description: true,
        number_of_sessions: true,
        days_validity: true,
        total_price: true,
        currency: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      success: true,
      message:
        packages.length === 0
          ? 'No session packages found for this coach'
          : 'Session packages retrieved successfully',
      data: {
        packages,
        total: packages.length,
      },
    };
  }

  async updateSessionPackage(
    coachId: string,
    id: string,
    updateSessionPackageDto: any,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    if (!id) throw new BadRequestException('Session Package ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const packages = await this.prisma.sessionsPackage.findFirst({
      where: {
        id,
        coach_id: coachId,
        coach_profile_id: coachProfile.id,
      },
    });
    if (!packages) throw new NotFoundException('Session Package not found');

    const updatedSessionPackage = await this.prisma.sessionsPackage.update({
      where: { id },
      data: {
        title: updateSessionPackageDto.title,
        description: updateSessionPackageDto.description,
        number_of_sessions: updateSessionPackageDto.number_of_sessions,
        days_validity: updateSessionPackageDto.days_validity,
        total_price: updateSessionPackageDto.total_price,
        currency: updateSessionPackageDto.currency,
      },
    });

    // notify coach about package update
    await this.createNotification(
      coachId,
      `You have successfully updated the session package: ${updateSessionPackageDto.title}`,
      NotificationType.SESSION_PACKAGE_PURCHASED,
      coachId,
      updatedSessionPackage.id,
    );

    return {
      success: true,
      message: 'Session package updated successfully',
      sessionPackage: updatedSessionPackage,
    };
  }

  async deleteSessionPackage(coachId: string, id: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!id) throw new BadRequestException('Session Package ID is required');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const packages = await this.prisma.sessionsPackage.findFirst({
      where: {
        id,
        coach_id: coachId,
        coach_profile_id: coachProfile.id,
      },
    });

    if (!packages) throw new NotFoundException('Session Package not found');

    await this.prisma.sessionsPackage.delete({ where: { id } });

    // notify coach about package deletion
    await this.createNotification(
      coachId,
      `You have successfully deleted the session package: ${packages.title}`,
      NotificationType.SESSION_PACKAGE_PURCHASED,
      coachId,
      packages.id,
    );

    return { success: true, message: 'Session Package deleted successfully' };
  }

  // -------------------------- search logic ----------------------
  async getSuggestedCoaches(athleteId: string, searchText?: string) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');

    const athlete = await this.prisma.user.findUnique({
      where: { id: athleteId },
    });

    // base filter: users who are coaches and have an active coach profile
    const where: any = {
      type: 'coach',
      coach_profile: { is: { status: 1 } },
    };

    const ors: any[] = [];

    // prefer coaches matching athlete.sports (supports comma-separated values)
    if (athlete && athlete.sports) {
      const athleteSports = Array.from(
        new Set(
          String(athlete.sports)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );

      if (athleteSports.length > 0) {
        ors.push({
          coach_profile: {
            is: {
              specialties: {
                hasSome: athleteSports,
              },
            },
          },
        });

        for (const sport of athleteSports) {
          ors.push({
            coach_profile: {
              is: {
                primary_specialty: { contains: sport, mode: 'insensitive' },
              },
            },
          });
        }
      }
    }

    // optional search text
    if (searchText && searchText.trim().length > 0) {
      const txt = searchText.trim();
      ors.push({ name: { contains: txt, mode: 'insensitive' } });
      ors.push({
        coach_profile: {
          is: { primary_specialty: { contains: txt, mode: 'insensitive' } },
        },
      });
      ors.push({ coach_profile: { is: { specialties: { has: txt } } } });
    }

    if (ors.length > 0) where.AND = [{ OR: ors }];

    const coaches = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        phone_number: true,
        bio: true,
        location: true,
        type: true,
        coach_profile: {
          select: {
            id: true,
            primary_specialty: true,
            specialties: true,
            experience_level: true,
            certifications: true,
            hourly_rate: true,
            hourly_currency: true,
            session_duration_minutes: true,
            session_price: true,
            is_verified: true,
            rating_count: true,
            avg_rating: true,
          },
        },
      },
      orderBy: [
        { coach_profile: { is_verified: 'desc' } },
        { coach_profile: { session_price: 'asc' } },
      ],
      take: 12,
    });

    return { items: coaches, total: coaches.length };
  }

  async getSearchCoaches(athleteId: string, searchText: string) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');

    const txt = (searchText || '').trim();

    const where: any = {
      type: 'coach',
      coach_profile: { is: { status: 1 } },
    };

    if (txt.length > 0) {
      where.AND = [
        {
          OR: [
            { name: { contains: txt, mode: 'insensitive' } },
            {
              coach_profile: {
                is: {
                  primary_specialty: { contains: txt, mode: 'insensitive' },
                },
              },
            },
            { coach_profile: { is: { specialties: { has: txt } } } },
          ],
        },
      ];
    }

    const results = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        phone_number: true,
        bio: true,
        location: true,

        coach_profile: {
          select: {
            id: true,
            primary_specialty: true,
            specialties: true,
            experience_level: true,
            certifications: true,
            hourly_rate: true,
            hourly_currency: true,
            session_duration_minutes: true,
            session_price: true,
            is_verified: true,
            rating_count: true,
            avg_rating: true,
          },
        },
      },
      orderBy: [
        { coach_profile: { is_verified: 'desc' } },
        { coach_profile: { session_price: 'asc' } },
      ],
      take: 50,
    });

    return { items: results, total: results.length };
  }

  async getCoachDetails(coachId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const coach = await this.prisma.user.findUnique({
      where: { id: coachId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        phone_number: true,
        bio: true,
        location: true,
        type: true,
        coach_profile: {
          select: {
            id: true,
            primary_specialty: true,
            specialties: true,
            available_days: true,
            weekend_days: true,
            blocked_days: true,
            blocked_time_slots: true,
            experience_level: true,
            certifications: true,
            hourly_rate: true,
            hourly_currency: true,
            session_duration_minutes: true,
            session_price: true,
            is_verified: true,
            avg_rating: true,
            rating_count: true,
            latitude: true,
            longitude: true,
            languages: true,
            coach_reviews: {
              select: {
                id: true,
                rating: true,
                review_text: true,
                created_at: true,
              },
            },
          },
        },
      },
    });

    if (!coach) {
      throw new NotFoundException('Coach not found');
    }

    // fetch session packages + stats in parallel
    const [packages, completedSessions, totalSessions] = await Promise.all([
      this.prisma.sessionsPackage.findMany({
        where: { coach_id: coachId },
        select: {
          id: true,
          title: true,
          description: true,
          number_of_sessions: true,
          days_validity: true,
          total_price: true,
          currency: true,
        },
      }),
      this.prisma.booking.count({
        where: { coach_id: coachId, status: 'COMPLETED' },
      }),
      this.prisma.booking.count({
        where: { coach_id: coachId },
      }),
    ]);

    const profile = coach.coach_profile;
    const avgRating = profile?.avg_rating ? Number(profile.avg_rating) : 0;
    const ratingCount =
      profile?.rating_count ?? (profile?.coach_reviews?.length || 0);

    return {
      success: true,
      message: 'Coach details retrieved successfully',
      coach: {
        id: coach.id,
        name: coach.name,
        email: coach.email,
        avatar: coach.avatar,
        phone_number: coach.phone_number,
        bio: coach.bio,
        location: coach.location,
      },
      profile: {
        id: profile?.id,
        primary_specialty: profile?.primary_specialty,
        specialties: profile?.specialties || [],
        experience_level: profile?.experience_level,
        certifications: profile?.certifications || [],
        hourly_rate: profile?.hourly_rate,
        hourly_currency: profile?.hourly_currency,
        session_duration_minutes: profile?.session_duration_minutes,
        session_price: profile?.session_price,
        is_verified: profile?.is_verified,
        avg_rating: avgRating,
        rating_count: ratingCount,
        available_days: profile?.available_days || [],
        weekend_days: profile?.weekend_days || [],
        blocked_days: profile?.blocked_days || [],
        latitude: profile?.latitude ? Number(profile.latitude) : null,
        longitude: profile?.longitude ? Number(profile.longitude) : null,
      },
      stats: {
        total_sessions: totalSessions,
        completed_sessions: completedSessions,
        experience: profile?.experience_level || null,
        languages: profile?.languages || [],
      },
      reviews: {
        average_rating: avgRating,
        total_reviews: ratingCount,
      },
      sessionsPackage: packages,
    };
  }

  async getAthleteDetails(coachId: string, athleteId: string) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!athleteId) throw new BadRequestException('Athlete ID is required');

    // Verify coach exists
    const coach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });
    if (!coach || coach.type !== 'coach') {
      throw new BadRequestException('Invalid coach ID');
    }

    // Fetch athlete details
    const athlete = await this.prisma.user.findUnique({
      where: { id: athleteId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        phone_number: true,
        bio: true,
        objectives: true,
        sports: true,
        age: true,
        location: true,
        type: true,
      },
    });
    if (!athlete) {
      throw new NotFoundException('Athlete not found');
    }

    // Verify coach-athlete relationship (check if they have completed bookings together)
    const coachingRelationship = await this.prisma.booking.findFirst({
      where: {
        coach_id: coachId,
        user_id: athleteId,
        status: {
          in: ['CONFIRMED', 'COMPLETED'],
        },
      },
    });

    if (!coachingRelationship) {
      throw new NotFoundException(
        'No coaching relationship found between this coach and athlete',
      );
    }

    // Fetch athlete's goals assigned to this coach + other goals
    const [athleteGoals, sessionHistory] = await Promise.all([
      // Fetch athlete's current goals
      this.prisma.goal.findMany({
        where: { user_id: athleteId },
        select: {
          id: true,
          title: true,
          current_value: true,
          target_value: true,
          target_date: true,
          frequency_per_week: true,
          motivation: true,
          progress_percent: true,
          coach_id: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      // Fetch athlete's completed session history with this specific coach
      this.prisma.booking.findMany({
        where: {
          coach_id: coachId,
          user_id: athleteId,
          status: 'COMPLETED',
        },
        select: {
          id: true,
          appointment_date: true,
          updated_at: true,
          duration_minutes: true,
          session_price: true,
          currency: true,
          number_of_sessions: true,
          total_completed_session: true,
          created_at: true,
          sessionPackage: {
            select: {
              id: true,
              title: true,
              description: true,
            },
          },
        },
        orderBy: { appointment_date: 'desc' },
      }),
    ]);

    // Enrich goals with coach assignment indicator
    const enrichedGoals = athleteGoals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      current_value: goal.current_value,
      target_value: goal.target_value,
      target_date: goal.target_date,
      frequency_per_week: goal.frequency_per_week,
      motivation: goal.motivation,
      progress_percent: goal.progress_percent,
      assigned_to_coach: goal.coach_id === coachId,
      created_at: goal.created_at,
      updated_at: goal.updated_at,
    }));

    // Calculate session statistics with this coach
    const totalSessions = sessionHistory.length;
    const lastSessionDate =
      sessionHistory.length > 0 ? sessionHistory[0].appointment_date : null;

    // Enrich session history with clear completion info
    const enrichedSessionHistory = sessionHistory.map((session) => ({
      id: session.id,
      title: session.sessionPackage
        ? session.sessionPackage.title
        : 'Single Session',
      status:
        session.total_completed_session >= session.number_of_sessions
          ? 'COMPLETED'
          : 'PARTIALLY_COMPLETED',
      appointment_date: session.appointment_date,
      completed_at: session.updated_at,
      duration_minutes: session.duration_minutes,
      session_price: session.session_price,
      currency: session.currency,
      number_of_sessions: session.number_of_sessions,
      total_completed_session: session.total_completed_session,
      created_at: session.created_at,
      sessionPackage: session.sessionPackage,
    }));

    return {
      success: true,
      message: 'Athlete details retrieved successfully',
      athlete,
      stats: {
        total_sessions_with_coach: totalSessions,
        last_session_date: lastSessionDate,
      },
      currentGoals: enrichedGoals,
      previousSessions: enrichedSessionHistory,
    };
  }

  async getCompletedBookings(userId: string) {
    if (!userId) throw new BadRequestException('User ID is required');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Coach view: return completed bookings where they are the coach
    if (user.type === 'coach') {
      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: userId },
      });
      if (!coachProfile) {
        console.error(
          `getCompletedBookings: coach profile not found for userId=${userId}`,
          { userId },
        );
        throw new NotFoundException('Coach profile not found');
      }

      const completedBookings = await this.prisma.booking.findMany({
        where: {
          coach_id: userId,
          coach_profile_id: coachProfile.id,
          status: 'COMPLETED',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              status: true,
              email: true,
              avatar: true,
              sports: true,
            },
          },
          sessionPackage: {
            select: {
              id: true,
              title: true,
              description: true,
              number_of_sessions: true,
              days_validity: true,
              total_price: true,
              currency: true,
            },
          },
        },
        orderBy: { appointment_date: 'desc' },
      });

      return {
        items: completedBookings || [],
        total: completedBookings?.length || 0,
      };
    }

    // Athlete view: return completed bookings for this athlete, include coach info
    const bookings = await this.prisma.booking.findMany({
      where: { user_id: userId, status: 'COMPLETED' },
      include: {
        coach_profile: {
          select: {
            id: true,
            status: true,
            primary_specialty: true,
            specialties: true,
            experience_level: true,
            certifications: true,
            hourly_rate: true,
            hourly_currency: true,
            session_duration_minutes: true,
            session_price: true,
            avg_rating: true,
            rating_count: true,
          },
        },
        sessionPackage: {
          select: {
            id: true,
            title: true,
            description: true,
            number_of_sessions: true,
            days_validity: true,
            total_price: true,
            currency: true,
          },
        },
      },
      orderBy: { appointment_date: 'desc' },
    });

    // batch fetch coach user data
    const coachIds = Array.from(new Set(bookings.map((b) => b.coach_id)));
    const coachUsers =
      coachIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: coachIds } },
            select: {
              id: true,
              name: true,
              status: true,
              email: true,
              phone_number: true,
              avatar: true,
              bio: true,
              objectives: true,
              goals: true,
              sports: true,
              age: true,
              location: true,
              type: true,
            },
          })
        : [];

    const coachMap: Record<string, any> = {};
    for (const u of coachUsers) coachMap[u.id] = u;

    const results = bookings.map((b) => ({
      ...b,
      coach: {
        user: coachMap[b.coach_id] || null,
        profile: b.coach_profile,
      },
    }));

    return { items: results, total: results.length };
  }
}
