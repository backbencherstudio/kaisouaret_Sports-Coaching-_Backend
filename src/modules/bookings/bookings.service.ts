import { Injectable } from '@nestjs/common';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { StripePayment } from 'src/common/lib/Payment/stripe/StripePayment';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async bookAppointment(
    athleteId: string,
    coachId: string,
    date: string,
    sessionPackageId?: string,
  ) {
    try {
      if (!athleteId) return { error: 'Athlete ID is required' };

      const getAthlete = await this.prisma.user.findUnique({
        where: { id: athleteId },
      });
      if (!getAthlete) return { error: 'Athlete not found' };

      const getCoach = await this.prisma.user.findUnique({
        where: { id: coachId },
      });
      if (!getCoach) return { error: 'Coach not found' };
      if (getCoach.type !== 'coach')
        return { error: 'The target user is not a coach' };

      const getCoachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });
      if (!getCoachProfile) return { error: 'Coach profile not found' };

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
        return { error: 'Invalid date format' };

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
        return { error: 'Booking already exists for this coach and date' };

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
      return { error: 'Failed to book appointment' };
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

  async getCoachBookings(coachId: string) {
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

  /**
   * Coach validates a booking using the token provided to the athlete after payment.
   * This marks the booking as COMPLETED and increments package counters where applicable.
   */
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

      // if this booking is a package booking and we've completed all sessions, you might want to take further action
      // e.g., mark package as used or notify the user; leave that for a follow-up.

      return {
        message: 'Booking validated and marked as completed',
        booking: updated,
      };
    } catch (error) {
      return { error: 'Failed to validate booking token' };
    }
  }

  /**
   * Athlete fetches the validation token for a booking (if payment succeeded and token exists).
   */
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
}
