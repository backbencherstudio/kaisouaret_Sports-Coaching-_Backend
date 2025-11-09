import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { StripePayment } from 'src/common/lib/Payment/stripe/StripePayment';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private isAppointmentBlockedManualWeekday(
    appointmentIso: string,
    blockedDays: string[] = [],
    blockedTimeSlots: string[] = [],
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

    // Exact blocked time-slot match
    for (const slot of blockedTimeSlots) {
      const sd = new Date(slot);
      if (!isNaN(sd.getTime()) && sd.getTime() === dt.getTime()) return true;
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

  async setBlockedDays(coachId: string, blockedDates: string[]) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!Array.isArray(blockedDates))
      throw new BadRequestException('blockedDates must be an array');

    const getCoach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });
    if (!getCoach || getCoach.type !== 'coach')
      throw new NotFoundException('Coach not found');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const sanitized: string[] = [];
    for (const d of blockedDates) {
      const s = String(d).trim();
      if (!s) continue;

      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
      if (!match) throw new BadRequestException(`Invalid date format: ${s}`);

      const year = Number(match[1]);
      const month = Number(match[2]).toString().padStart(2, '0');
      const day = Number(match[3]).toString().padStart(2, '0');
      const isoDate = `${year}-${month}-${day}`;

      sanitized.push(isoDate);
    }

    const existing = coachProfile.blocked_days ?? [];
    const todayIso = new Date().toISOString().slice(0, 10);

    const validExisting = existing.filter((d) => d >= todayIso);
    const merged = Array.from(new Set([...validExisting, ...sanitized]));

    const updated = await this.prisma.coachProfile.update({
      where: { id: coachProfile.id },
      data: { blocked_days: merged },
    });

    return {
      message: 'Blocked days updated successfully',
      blocked_days: updated.blocked_days,
    };
  }

  async blockedDays(coachId: string): Promise<string[]> {
    try {
      if (!coachId) throw new Error('Coach ID is required');

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
        select: { blocked_days: true },
      });
      return coachProfile?.blocked_days || [];
    } catch (error) {
      console.error('Error fetching blocked days:', error);
      throw new Error('Could not fetch blocked days');
    }
  }

  async blockedTimeSlots(coachId: string): Promise<string[]> {
    try {
      if (!coachId) throw new Error('Coach ID is required');

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
        select: { blocked_time_slots: true },
      });
      return coachProfile?.blocked_time_slots || [];
    } catch (error) {
      console.error('Error fetching blocked time slots:', error);
      throw new NotFoundException('Could not fetch blocked time slots');
    }
  }

  async setBlockedTimeSlots(
    coachId: string,
    blockedTimeSlots: string[],
  ): Promise<{ message: string; blocked_time_slots: string[] }> {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!Array.isArray(blockedTimeSlots))
      throw new BadRequestException('blockedTimeSlots must be an array');

    const getCoach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });
    if (!getCoach || getCoach.type !== 'coach')
      throw new NotFoundException('Coach not found');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    const sanitized: string[] = [];
    for (const t of blockedTimeSlots) {
      const s = String(t).trim();
      if (!s) continue;
      const dt = new Date(s);
      if (isNaN(dt.getTime()))
        throw new BadRequestException(`Invalid datetime format: ${s}`);
      sanitized.push(dt.toISOString());
    }

    const updated = await this.prisma.coachProfile.update({
      where: { id: coachProfile.id },
      data: { blocked_time_slots: sanitized },
    });
    return {
      message: 'Blocked time slots updated',
      blocked_time_slots: updated.blocked_time_slots,
    };
  }

  async weekendDays(coachId: string): Promise<string[]> {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const coachProfile = (await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
      select: { weekend_days: true } as any,
    })) as any;

    return coachProfile?.weekend_days || [];
  }

  async setWeekendDays(coachId: string, weekendDays: string[]) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    if (!Array.isArray(weekendDays))
      throw new BadRequestException('weekendDays must be an array');

    const getCoach = await this.prisma.user.findUnique({
      where: { id: coachId },
    });

    if (!getCoach || getCoach.type !== 'coach')
      throw new NotFoundException('Coach not found');

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) throw new NotFoundException('Coach profile not found');

    // validate and sanitize entries (same rules as blockedDays)
    const weekdayNames = new Set([
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

    const sanitized: string[] = [];
    for (const d of weekendDays) {
      const s = String(d).trim();
      if (!s) continue;
      // weekday name
      if (weekdayNames.has(s.toLowerCase())) {
        sanitized.push(s.toLowerCase());
        continue;
      }
      // try parse date YYYY-MM-DD
      const dt = new Date(s);
      if (!isNaN(dt.getTime())) {
        const isoDate = new Date(
          Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()),
        )
          .toISOString()
          .slice(0, 10);
        sanitized.push(isoDate);
        continue;
      }
      throw new BadRequestException(`Invalid weekend day format: ${s}`);
    }

    const updated = await this.prisma.coachProfile.update({
      where: { id: (coachProfile as any).id },
      data: { weekend_days: sanitized } as any,
    } as any);

    return {
      message: 'Weekend days updated',
      weekend_days: (updated as any).weekend_days,
    } as any;
  }

  async getAvailableDays(coachId: string): Promise<string[]> {
    if (!coachId) throw new BadRequestException('Coach ID is required');

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
    const weekendDays = coachProfile.weekend_days ?? [];

    console.log('block days', blockedDays);
    console.log('weekend days', weekendDays);

    // === Calculate 7-day range ===
    const now = new Date();
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(now.getDate() + 7);

    // Filter blocked days that fall within the next 7 days only
    const upcomingBlockedDays = blockedDays.filter((d) => {
      const date = new Date(d);
      return date >= now && date <= sevenDaysLater;
    });

    console.log(
      'upcoming blocked days (within next 7 days):',
      upcomingBlockedDays,
    );

    // Convert blocked dates to weekday names
    const blockedDaysAsNames = upcomingBlockedDays.map((d) => {
      const date = new Date(d);
      return daysOfWeek[date.getUTCDay()];
    });

    console.log('blocked days as names', blockedDaysAsNames);

    // Combine blocked days and weekend days
    const allBlocked = new Set(
      [...blockedDaysAsNames, ...weekendDays].map((d) => d.toLowerCase()),
    );

    console.log(
      'all blocked days (within next 7 days + weekends):',
      allBlocked,
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

    console.log('next 7 available days', next7AvailableDays);

    // Save the available days for this 7-day window
    const updated = await this.prisma.coachProfile.update({
      where: { user_id: coachId },
      data: { available_days: next7AvailableDays },
    });

    return updated.available_days;
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
      });
      if (!getCoachProfile)
        throw new NotFoundException('Coach profile not found');

      await this.cleanupExpiredBlockedDays(coachId);

      // parse and validate date (accept flexible formats like 2025-10-5T10:55:51.710Z)
      const normalizeDateString = (s: string) => {
        if (!s || typeof s !== 'string') return s;
        // allow space instead of T
        let str = s.replace(' ', 'T');
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
        throw new BadRequestException('Invalid date format');

      // check coach blocked days/time slots using manual weekday logic
      const blockedDaysArr = getCoachProfile.blocked_days || [];
      const weekendDaysArr = (getCoachProfile as any).weekend_days || [];
      const combinedBlockedDays = [...blockedDaysArr, ...weekendDaysArr];
      const blockedSlotsArr = getCoachProfile.blocked_time_slots || [];

      if (
        this.isAppointmentBlockedManualWeekday(
          normalized,
          combinedBlockedDays,
          blockedSlotsArr,
        )
      ) {
        return { error: 'Selected date/time is blocked by the coach' };
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
      if (existingBooking)
        throw new ConflictException(
          'Booking already exists for this coach and date',
        );

      // If a sessionPackageId is provided, validate it belongs to this coach
      let sessionPackage = null;
      if (sessionPackageId) {
        sessionPackage = await this.prisma.sessionsPackage.findUnique({
          where: { id: sessionPackageId },
        });
        if (!sessionPackage) return { error: 'Session package not found' };
        if (
          sessionPackage.coach_id !== coachId ||
          sessionPackage.coach_profile_id !== getCoachProfile.id
        ) {
          return { error: 'Session package does not belong to this coach' };
        }
      }

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
      };

      if (!sessionPackage) {
        // create booking record (pending payment)
        const booking = await this.prisma.booking.create({ data: baseData });

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

        // create payment intent
        const amount =
          Number(booking.session_price) || Number(booking.total_amount) || 0;
        console.log('ammount', amount);
        const currency = booking.currency || 'USD';
        const paymentIntent = await StripePayment.createPaymentIntent({
          amount,
          currency,
          customer_id: customerId,
          metadata: { booking_id: booking.id, user_id: getAthlete.id },
        });

        // create payment transaction and link to booking
        const tx = await this.prisma.paymentTransaction.create({
          data: {
            user_id: getAthlete.id,
            amount: amount || undefined,
            currency: currency || undefined,
            reference_number: paymentIntent.id,
            status: 'pending',
          },
        });

        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { payment_transaction_id: tx.id },
        });

        return { booking, clientSecret: paymentIntent.client_secret };
      }

      // session package booking: compute per-session price
      const totalPrice = Number(sessionPackage.total_price) || 0;
      const numberOfSessions = Number(sessionPackage.number_of_sessions) || 1;
      const sessionPrice =
        numberOfSessions > 0 ? totalPrice / numberOfSessions : 0;

      const packageData = {
        ...baseData,
        sessionPackage: { connect: { id: sessionPackage.id } },
        title: sessionPackage.title,
        description: sessionPackage.description,
        number_of_sessions: numberOfSessions,
        days_validity: sessionPackage.days_validity,
        total_completed_session: 0,
        total_amount: sessionPackage.total_price,
        session_price: sessionPrice,
        currency: sessionPackage.currency ?? baseData.currency,
      };

      // create booking record for package (pending payment)
      const booking = await this.prisma.booking.create({ data: packageData });

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

      // create payment intent for package total
      const amount = Number(booking.total_amount) || 0;
      const currency = booking.currency || 'USD';
      const paymentIntent = await StripePayment.createPaymentIntent({
        amount,
        currency,
        customer_id: customerId,
        metadata: {
          booking_id: booking.id,
          user_id: getAthlete.id,
          package_id: sessionPackage.id,
        },
      });

      const tx = await this.prisma.paymentTransaction.create({
        data: {
          user_id: getAthlete.id,
          amount: amount || undefined,
          currency: currency || undefined,
          reference_number: paymentIntent.id,
          status: 'pending',
        },
      });

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { payment_transaction_id: tx.id },
      });

      return {
        message: 'Session booking created (awaiting payment)',
        booking,
        clientSecret: paymentIntent.client_secret,
      };
    } catch (error) {
      // Log full error server-side for debugging
      console.error('bookAppointment error:', error);
      // Return helpful message to the client in dev; preserve a generic fallback
      const msg =
        error && (error as any).message
          ? (error as any).message
          : 'Failed to book appointment';
      return { error: msg };
    }
  }

  async getAthleteBookings(athleteId: string) {
    try {
      if (!athleteId) {
        return { error: 'Athlete ID is required' };
      }

      const bookings = await this.prisma.booking.findMany({
        where: { user_id: athleteId },
        include: {
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
            },
          },
        },
      });

      if (!bookings || bookings.length === 0) {
        return { error: 'No bookings found for this athlete' };
      }

      return bookings;
    } catch (error) {
      return { error: 'Failed to retrieve athlete bookings' };
    }
  }

  async getAthleteBookingsByDate(athleteId: string, date: string) {
    try {
      if (!athleteId) {
        return { error: 'Athlete ID is required' };
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
        return { error: 'Invalid date format' };
      }
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);

      const bookings = await this.prisma.booking.findMany({
        where: {
          user_id: athleteId,
          appointment_date: { gte: start, lt: end },
        },
        include: {
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
            },
          },
        },
      });

      if (!bookings || bookings.length === 0) {
        return {
          error: 'No bookings found for this athlete on the specified date',
        };
      }

      return bookings;
    } catch (error) {
      return { error: 'Failed to retrieve athlete bookings by date' };
    }
  }

  async getBookingById(athleteId: string, bookingId: string) {
    try {
      if (!athleteId) {
        return { error: 'Athlete ID is required' };
      }

      if (!bookingId) {
        return { error: 'Booking ID is required' };
      }

      const booking = await this.prisma.booking.findFirst({
        where: {
          id: bookingId,
          user_id: athleteId,
        },
        include: {
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
            },
          },
        },
      });
      if (!booking) return { error: 'Booking not found' };

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
        },
      });

      return {
        ...booking,
        coach: {
          user: coachUser,
          profile: coachProfile,
        },
      };
    } catch (error) {
      return { error: 'Failed to retrieve booking' };
    }
  }

  // coach bookings

  async getCoachBookings(coachId: string) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!coachProfile) {
        console.error(
          `getCompletedBooking: coach profile not found for coachId=${coachId}`,
          {
            coachId,
          },
        );
        // return empty array so client receives consistent empty-result response
        return [] as any;
      }

      const bookings = await this.prisma.booking.findMany({
        where: {
          coach_id: coachId,
          coach_profile_id: coachProfile.id,
        },
        include: {
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

      if (!bookings || bookings.length === 0) {
        return { error: 'No bookings found for this coach' };
      }

      return bookings;
    } catch (error) {
      return { error: 'Failed to retrieve coach bookings' };
    }
  }

  async getCoachBookingsByDate(coachId: string, date: string) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });

      if (!coachProfile) {
        return { error: 'Coach profile not found' };
      }

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
        return { error: 'Invalid date format' };
      }
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);

      const bookings = await this.prisma.booking.findMany({
        where: {
          coach_id: coachId,
          coach_profile_id: coachProfile.id,
          appointment_date: { gte: start, lt: end },
        },
        include: {
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

      if (!bookings || bookings.length === 0) {
        return {
          error: 'No bookings found for this coach on the specified date',
        };
      }

      return bookings;
    } catch (error) {
      return { error: 'Failed to retrieve coach bookings by date' };
    }
  }

  /**
   * Get upcoming bookings for the logged-in user. If user is a coach, return upcoming bookings where they are the coach.
   * If user is an athlete, return upcoming bookings where they are the athlete (and include coach details).
   */
  async getUpcomingBookings(userId: string) {
    try {
      if (!userId) return { error: 'User ID is required' };

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return { error: 'User not found' };

      const now = new Date();

      if (user.type === 'coach') {
        // coach view: include athlete (user) details
        console.log('hit');
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
          include: {
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
            },
          },
        },
        orderBy: { appointment_date: 'asc' },
      });

      // console.log('bookings details', bookings);

      // fetch coach user details in batch
      const coachIds = Array.from(new Set(bookings.map((b) => b.coach_id)));
      const coachUsers = await this.prisma.user.findMany({
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
      });
      const coachMap: Record<string, any> = {};
      for (const u of coachUsers) coachMap[u.id] = u;

      const results = bookings.map((b) => ({
        ...b,
        coach: {
          user: coachMap[b.coach_id] || null,
          profile: b.coach_profile,
        },
      }));

      return results;
    } catch (error) {
      console.error('getUpcomingBookings error', error);
      return { error: 'Failed to get upcoming bookings' };
    }
  }

  async getBookingByIdForCoach(coachId: string, bookingId: string) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }

      if (!bookingId) {
        return { error: 'Booking ID is required' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!coachProfile) {
        return { error: 'Coach profile not found' };
      }

      const booking = await this.prisma.booking.findFirst({
        where: {
          id: bookingId,
          coach_id: coachId,
          coach_profile_id: coachProfile.id,
        },
        include: {
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
      if (!booking) return { error: 'Booking not found' };

      return booking; // For coach view we intentionally return athlete (user) details and avoid returning coach_profile (self) to the response
    } catch (error) {
      return { error: 'Failed to retrieve booking' };
    }
  }

  async updateBooking(
    coachId: string,
    bookingId: string,
    updateBookingDto: UpdateBookingDto,
  ) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!coachProfile) {
        return { error: 'Coach profile not found' };
      }

      if (!bookingId) {
        return { error: 'Booking ID is required' };
      }

      const booking = await this.prisma.booking.findFirst({
        where: {
          coach_id: coachId,
          coach_profile_id: coachProfile.id,
          id: bookingId,
        },
      });
      if (!booking) {
        return { error: 'Booking not found' };
      }

      const updatedBooking = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          ...updateBookingDto,
        },
      });

      return updatedBooking;
    } catch (error) {
      return { error: 'Failed to update booking' };
    }
  }

  async validateBookingToken(
    coachId: string,
    bookingId: string,
    token: string,
  ) {
    try {
      if (!coachId) return { error: 'Coach ID is required' };
      if (!bookingId) return { error: 'Booking ID is required' };
      if (!token) return { error: 'Validation token is required' };

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!coachProfile) return { error: 'Coach profile not found' };

      const booking = await this.prisma.booking.findFirst({
        where: {
          id: bookingId,
          coach_profile_id: coachProfile.id,
          coach_id: coachId,
        },
      });
      if (!booking) return { error: 'Booking not found' };

      if (!booking.validation_token || !booking.token_expires_at)
        return { error: 'No validation token available for this booking' };
      const now = new Date();
      if (new Date(booking.token_expires_at) < now)
        return { error: 'Validation token has expired' };
      if (booking.validation_token !== token)
        return { error: 'Invalid validation token' };

      // mark booking completed and clear token (single-use)
      const updated = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: 'COMPLETED',
          validation_token: null,
          token_expires_at: null,
          total_completed_session: (booking.total_completed_session || 0) + 1,
        },
      });

      return {
        message: 'Booking validated and marked as completed',
        booking: updated,
      };
    } catch (error) {
      return { error: 'Failed to validate booking token' };
    }
  }

  async getBookingToken(athleteId: string, bookingId: string) {
    try {
      if (!athleteId) return { error: 'Athlete ID is required' };
      if (!bookingId) return { error: 'Booking ID is required' };

      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, user_id: athleteId },
      });
      if (!booking) return { error: 'Booking not found' };
      if (!booking.validation_token)
        return { error: 'No validation token available' };

      const now = new Date();
      if (booking.token_expires_at && new Date(booking.token_expires_at) < now)
        return { error: 'Validation token has expired' };

      return {
        validation_token: booking.validation_token,
        expires_at: booking.token_expires_at,
      };
    } catch (error) {
      return { error: 'Failed to retrieve booking token' };
    }
  }

  //
  // ------------------------- session package -----------------------
  //
  async createSessionPackage(coachId: string, createSessionPackageDto: any) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }

      const getCoach = await this.prisma.user.findUnique({
        where: { id: coachId },
      });

      if (!getCoach || getCoach.type !== 'coach') {
        return { error: 'Coach not found' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!coachProfile) {
        return { error: 'Coach profile not found' };
      }

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

      return sessionPackage;
    } catch (error) {
      return { error: 'Failed to create session package' };
    }
  }

  async getSessionPackages(coachId: string) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: {
          user_id: coachId,
        },
      });
      if (!coachProfile) {
        return { error: 'Coach profile not found' };
      }

      // console.log('coach id', coachProfile.id);

      const packages = await this.prisma.sessionsPackage.findMany({
        where: { coach_id: coachId, coach_profile_id: coachProfile.id },
      });
      if (!packages || packages.length === 0) {
        return { error: 'No session packages found for this coach' };
      }
      return packages;
    } catch (error) {
      return { error: 'Failed to retrieve session packages' };
    }
  }

  async updateSessionPackage(
    coachId: string,
    id: string,
    updateSessionPackageDto: any,
  ) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }

      if (!id) {
        return { error: 'Session Package ID is required' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!coachProfile) {
        return { error: 'Coach profile not found' };
      }

      const packages = await this.prisma.sessionsPackage.findFirst({
        where: {
          id,
          coach_id: coachId,
          coach_profile_id: coachProfile.id,
        },
      });
      if (!packages) {
        return { error: 'Session Package not found' };
      }

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

      return updatedSessionPackage;
    } catch (error) {
      return { error: 'Failed to update session package' };
    }
  }

  async deleteSessionPackage(coachId: string, id: string) {
    try {
      if (!coachId) {
        return { error: 'Coach ID is required' };
      }
      if (!id) {
        return { error: 'Session Package ID is required' };
      }

      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!coachProfile) {
        return { error: 'Coach profile not found' };
      }

      const packages = await this.prisma.sessionsPackage.findFirst({
        where: {
          id,
          coach_id: coachId,
          coach_profile_id: coachProfile.id,
        },
      });

      if (!packages) {
        return { error: 'Session Package not found' };
      }

      await this.prisma.sessionsPackage.delete({ where: { id } });

      return { message: 'Session Package deleted successfully' };
    } catch (error) {
      return { error: 'Failed to delete session package' };
    }
  }

  // -------------------------- search logic ----------------------
  async getSuggestedCoaches(athleteId: string, searchText?: string) {
    try {
      if (!athleteId) return { error: 'Athlete ID is required' };

      const athlete = await this.prisma.user.findUnique({
        where: { id: athleteId },
      });

      // base filter: users who are coaches and have an active coach profile
      const where: any = {
        type: 'coach',
        coach_profile: { is: { status: 1 } },
      };

      const ors: any[] = [];

      // prefer coaches matching athlete.sports
      if (athlete && athlete.sports) {
        const sport = athlete.sports;
        ors.push({ coach_profile: { is: { specialties: { has: sport } } } });
        ors.push({
          coach_profile: {
            is: { primary_specialty: { contains: sport, mode: 'insensitive' } },
          },
        });
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
            },
          },
        },
        orderBy: [
          { coach_profile: { is_verified: 'desc' } },
          { coach_profile: { session_price: 'asc' } },
        ],
        take: 12,
      });

      return coaches;
    } catch (err) {
      console.error('getSuggestedCoaches error', err);
      return { error: 'Failed to get suggested coaches' };
    }
  }

  async getSearchCoaches(athleteId: string, searchText: string) {
    try {
      if (!athleteId) return { error: 'Athlete ID is required' };

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
            },
          },
        },
        orderBy: [
          { coach_profile: { is_verified: 'desc' } },
          { coach_profile: { session_price: 'asc' } },
        ],
        take: 50,
      });

      return results;
    } catch (err) {
      console.error('getSearchCoaches error', err);
      return { error: 'Failed to search coaches' };
    }
  }

  async getCompletedBookings(userId: string) {
    try {
      if (!userId) {
        return { error: 'User ID is required' };
      }

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return { error: 'User not found' };

      // Coach view: return completed bookings where they are the coach
      if (user.type === 'coach') {
        const coachProfile = await this.prisma.coachProfile.findUnique({
          where: { user_id: userId },
        });
        if (!coachProfile) {
          console.error(
            `getCompletedBookings: coach profile not found for userId=${userId}`,
            {
              userId,
            },
          );
          return [] as any;
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

        return completedBookings || [];
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

      return results;
    } catch (err) {
      console.error('getCompletedBookings error', err);
      return { error: 'Failed to get completed bookings' };
    }
  }

  async sendReviewToCoach(
    athleteId: string,
    bookingId: string,
    reviewDto: any,
  ) {
    try {
      if (!athleteId) return { error: 'Athlete ID is required' };
      if (!bookingId) return { error: 'Booking ID is required' };
      // Accept either a body object { review, rating } or a raw string body
      if (typeof reviewDto === 'string') {
        reviewDto = { review: reviewDto };
      }
      if (!reviewDto || !reviewDto.review)
        return { error: 'Review content is required' };

      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, user_id: athleteId },
      });
      if (!booking) return { error: 'Booking not found' };

      // Only allow reviews for completed bookings
      if (booking.status !== 'COMPLETED') {
        return { error: 'You can only review a completed booking' };
      }

      // Prevent duplicate review for the same booking by same athlete
      const existing = await this.prisma.coachReview.findFirst({
        where: { booking_id: bookingId, athlete_id: athleteId },
      });
      if (existing) return { error: 'Review already submitted for this booking' };

      // Create coach-level review (coach_id references coach_profile.id in schema)
      const coachReview = await this.prisma.coachReview.create({
        data: {
          coach_id: booking.coach_profile_id,
          athlete_id: athleteId,
          booking_id: bookingId,
          review_text: reviewDto.review,
          rating: reviewDto.rating || null,
        },
      });

      // Recompute aggregated rating for coach profile (avg + count)
      try {
        const agg = await this.prisma.coachReview.aggregate({
          where: {
            coach_id: booking.coach_profile_id,
            rating: { not: null },
          },
          _avg: { rating: true },
          _count: { rating: true },
        });

        const avg = agg._avg?.rating ? Number(agg._avg.rating) : null;
        const count = agg._count?.rating ?? 0;

        await this.prisma.coachProfile.update({
          where: { id: booking.coach_profile_id },
          data: {
            avg_rating: avg,
            rating_count: count,
          },
        });
      } catch (aggErr) {
        // Non-fatal: log and continue
        console.error('Failed to update coach profile aggregates', aggErr);
      }

      return coachReview;
    } catch (err) {
      console.error('sendReviewToCoach error', err);
      return { error: 'Failed to send review to coach' };
    }
  }
}
