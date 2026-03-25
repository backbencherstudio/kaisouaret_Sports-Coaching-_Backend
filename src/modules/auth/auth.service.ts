// external imports
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Prisma } from '@prisma/client';

//internal imports
import appConfig from '../../config/app.config';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRepository } from '../../common/repository/user/user.repository';
import { MailService } from '../../mail/mail.service';
import { UcodeRepository } from '../../common/repository/ucode/ucode.repository';
import { UpdateUserDto } from './dto/update-user.dto';
import { SazedStorage } from '../../common/lib/Disk/SazedStorage';
import { DateHelper } from '../../common/helper/date.helper';
import { StripePayment } from '../../common/lib/Payment/stripe/StripePayment';
import { StringHelper } from '../../common/helper/string.helper';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mailService: MailService,
    @InjectRedis() private readonly redis: Redis,
    private notificationsService: NotificationsService,
  ) {}

  async me(userId: string) {
    try {
      const user = await (this.prisma as any).user.findFirst({
        where: {
          id: userId,
        },
        select: {
          id: true,
          status: true,
          name: true,
          avatar: true,
          email: true,
          phone_number: true,
          type: true,
          gender: true,
          date_of_birth: true,
          age: true,
          created_at: true,
          updated_at: true,
          email_verified_at: true,
          location: true,
          latitude: true,
          longitude: true,
          bio: true,
          objectives: true,
          goals: true,
          sports: true,
          role_users: { select: { role: true } },
          coach_profile: {
            select: {
              id: true,
              created_at: true,
              updated_at: true,
              status: true,
              user_id: true,
              primary_specialty: true,
              specialties: true,
              experience_level: true,
              certifications: true,
              session_price: true,
              session_duration_minutes: true,
              hourly_rate: true,
              hourly_currency: true,
              is_verified: true,
              registration_fee_paid: true,
              registration_fee_paid_at: true,
              subscription_active: true,
              subscription_started_at: true,
              subscription_expires_at: true,
              subscription_provider: true,
              subscription_reference: true,
              rgpd_laws_agreement: true,
              location: true,
              latitude: true,
              longitude: true,
              languages: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const now = new Date();
      const activeSubscription = await this.prisma.userSubscription.findFirst({
        where: {
          user_id: userId,
          status: 'active',
          deleted_at: null,
          current_period_end: { gte: now },
        },
        include: {
          plan: true,
        },
      });

      const subscriptionInfo = {
        is_active: !!activeSubscription,
        kind: activeSubscription?.plan?.kind || null,
        plan_id: activeSubscription?.plan_id || null,
        current_period_end: activeSubscription?.current_period_end || null,
        status: activeSubscription?.status || null,
      };

      return {
        success: true,
        data: {
          ...user,
          subscription: subscriptionInfo,
        },
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to fetch user');
    }
  }

  /**
   * Step 1: Request registration - sends OTP, stores data temporarily
   */
  async requestRegistration({
    name,
    email,
    phone_number,
    location,
    latitude,
    longitude,
    date_of_birth,
    password,
    bio,
    type,
    avatar,
  }: {
    name: string;
    email: string;
    password: string;
    location?: string;
    latitude?: number;
    longitude?: number;
    phone_number?: string;
    type?: string;
    bio?: string;
    date_of_birth?: string;
    avatar?: Express.Multer.File;
  }) {
    try {
      // Check if email already exists
      const userEmailExist = await UserRepository.exist({
        field: 'email',
        value: String(email),
      });

      if (userEmailExist) {
        throw new ConflictException('Email already exists');
      }

      const emailAlreadyExistInDB = await this.prisma.user.findUnique({
        where: { email },
      });

      if (emailAlreadyExistInDB) {
        throw new ConflictException('Email already exists');
      }

      // Generate OTP
      const otp = Math.floor(1000 + Math.random() * 9000).toString();

      // Store registration data temporarily in Redis (expires in 15 minutes)
      const registrationData = {
        name,
        email,
        phone_number,
        location,
        latitude,
        longitude,
        date_of_birth,
        password,
        bio,
        type,
        avatarBuffer: avatar?.buffer ? avatar.buffer.toString('base64') : null,
        avatarOriginalName: avatar?.originalname || null,
      };

      console.log('Storing registration data for:', email);

      await this.redis.setex(
        `registration_pending:${email}`,
        900, // 15 minutes
        JSON.stringify(registrationData),
      );

      // Store OTP separately
      await this.redis.setex(
        `registration_otp:${email}`,
        900, // 15 minutes
        otp,
      );

      console.log('OTP generated and stored:', otp);

      // Send OTP to email
      await this.mailService.sendOtpCodeToEmail({
        email,
        name,
        otp,
      });

      return {
        success: true,
        message: 'We have sent a verification code to your email',
        otp, // For testing only - remove in production
      };
    } catch (error) {
      const details = error?.message ?? 'Registration request failed';
      throw new BadRequestException(details);
    }
  }

  /**
   * Step 2: Verify OTP and complete registration
   */
  async verifyAndRegister({ email, otp }: { email: string; otp: string }) {
    try {
      // Verify OTP
      const storedOtp = await this.redis.get(`registration_otp:${email}`);

      if (!storedOtp || storedOtp !== otp) {
        throw new BadRequestException('Invalid or expired OTP');
      }

      // Get registration data
      const registrationDataJson = await this.redis.get(
        `registration_pending:${email}`,
      );

      if (!registrationDataJson) {
        throw new BadRequestException(
          'Registration data expired. Please register again',
        );
      }

      const registrationData = JSON.parse(registrationDataJson);

      // Upload avatar if exists
      let mediaUrl: string | undefined = undefined;

      if (
        registrationData.avatarBuffer &&
        registrationData.avatarOriginalName
      ) {
        try {
          const buffer = Buffer.from(registrationData.avatarBuffer, 'base64');
          const safeName = registrationData.avatarOriginalName
            .toLowerCase()
            .replace(/[^a-z0-9.\s-_]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');

          const fileName = `${StringHelper.randomString()}-${safeName}`;

          await SazedStorage.put(
            `${appConfig().storageUrl.avatar}/${fileName}`,
            buffer,
          );

          mediaUrl = SazedStorage.url(
            encodeURI(`${appConfig().storageUrl.avatar}/${fileName}`),
          );
        } catch (error) {
          console.error('Failed to upload avatar:', error);
        }
      }

      // Create user
      const user = await UserRepository.createUser({
        name: registrationData.name,
        email: registrationData.email,
        phone_number: registrationData.phone_number,
        location: registrationData.location,
        latitude: registrationData.latitude,
        longitude: registrationData.longitude,
        bio: registrationData.bio,
        date_of_birth: registrationData.date_of_birth
          ? DateHelper.format(registrationData.date_of_birth)
          : undefined,
        age: registrationData.date_of_birth
          ? DateHelper.calculateAge(registrationData.date_of_birth)
          : undefined,
        password: registrationData.password,
        type: registrationData.type,
        avatar: mediaUrl,
      });

      console.log('User creation result:', user);

      if (!user || !user.data || !user.data.id) {
        console.error('User creation failed. Result:', JSON.stringify(user));
        throw new BadRequestException(
          'Failed to create account. Please try again.',
        );
      }

      // Mark email as verified immediately
      await this.prisma.user.update({
        where: { id: user.data.id },
        data: { email_verified_at: new Date() },
      });

      // Create Stripe customer account
      try {
        const stripeCustomer = await StripePayment.createCustomer({
          user_id: user.data.id,
          email: registrationData.email,
          name: registrationData.name,
        });

        if (stripeCustomer) {
          await this.prisma.user.update({
            where: { id: user.data.id },
            data: { billing_id: stripeCustomer.id },
          });
        }
      } catch (error) {
        console.error('Failed to create Stripe customer:', error);
      }

      // Send welcome notification
      try {
        await this.notificationsService.sendNotification({
          type: NotificationType.USER_REGISTERED,
          recipient_id: user.data.id,
          variables: {
            user_name: registrationData.name,
            platform_name: 'Sports Coaching',
          },
        });
      } catch (error) {
        console.error('Failed to send welcome notification:', error);
      }

      // If user is registering as coach, create coach profile
      if (registrationData.type === 'coach') {
        try {
          console.log('Creating coach profile for user:', user.data.id);
          await this.prisma.coachProfile.create({
            data: {
              user_id: user.data.id,
              // Coach can set these later in setupProfile()
            },
          });
          console.log('Coach profile created successfully');
        } catch (error) {
          console.error('Failed to create coach profile:', error);
          // Don't throw error - coach profile can be created later
        }
      }

      // Clean up Redis
      await this.redis.del(`registration_pending:${email}`);
      await this.redis.del(`registration_otp:${email}`);

      // Auto-login after successful registration verification
      const loginResponse = await this.login({
        email: registrationData.email,
        userId: user.data.id,
      });

      return {
        success: true,
        message:
          'Registration completed successfully. Please setup your profile.',
        authorization: loginResponse.authorization,
        type: loginResponse.type,
      };
    } catch (error) {
      console.error('verifyAndRegister error:', error);
      const details = error?.message ?? 'Registration verification failed';
      throw new BadRequestException(details);
    }
  }

  /**
   * Legacy method - kept for backward compatibility
   * @deprecated Use requestRegistration() and verifyAndRegister() instead
   */
  async register({
    name,
    email,
    phone_number,
    location,
    latitude,
    longitude,
    date_of_birth,
    password,
    bio,
    type,
    avatar,
  }: {
    name: string;
    email: string;
    password: string;
    location: string;
    latitude: number;
    longitude: number;
    phone_number: string;
    type?: string;
    bio?: string;
    date_of_birth?: string;
    coach_profile?: any;
    avatar?: Express.Multer.File;
  }) {
    // Redirect to new two-step flow
    return this.requestRegistration({
      name,
      email,
      phone_number,
      location,
      latitude,
      longitude,
      date_of_birth,
      password,
      bio,
      type,
      avatar,
    });
  }

  // Parse a DTO string field that may be comma-separated or a JSON array
  // into a string array suitable for Prisma String[] columns.
  private parseStringArray(value: string | string[] | undefined): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // fall through to comma split
    }
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async updateUser(
    userId: string,
    updateUserDto: UpdateUserDto,
    avatar?: Express.Multer.File,
  ) {
    try {
      const user = await UserRepository.getUserDetails(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // ── User model fields ──────────────────────────────────────────
      const userData: any = {};

      if (updateUserDto.name !== undefined) userData.name = updateUserDto.name;
      if (updateUserDto.phone_number !== undefined)
        userData.phone_number = updateUserDto.phone_number;
      if (updateUserDto.country !== undefined)
        userData.country = updateUserDto.country;
      if (updateUserDto.state !== undefined)
        userData.state = updateUserDto.state;
      if (updateUserDto.city !== undefined) userData.city = updateUserDto.city;
      if (updateUserDto.zip_code !== undefined)
        userData.zip_code = updateUserDto.zip_code;
      if (updateUserDto.address !== undefined)
        userData.address = updateUserDto.address;
      if (updateUserDto.location !== undefined)
        userData.location = updateUserDto.location;
      if (updateUserDto.latitude !== undefined)
        userData.latitude = updateUserDto.latitude;
      if (updateUserDto.longitude !== undefined)
        userData.longitude = updateUserDto.longitude;
      if (updateUserDto.gender !== undefined)
        userData.gender = updateUserDto.gender;
      if (updateUserDto.date_of_birth !== undefined)
        userData.date_of_birth = DateHelper.format(updateUserDto.date_of_birth);
      if (updateUserDto.bio !== undefined) userData.bio = updateUserDto.bio;
      if (updateUserDto.objectives !== undefined)
        userData.objectives = updateUserDto.objectives;
      if (updateUserDto.goals !== undefined)
        userData.goals = updateUserDto.goals;
      if (updateUserDto.sports !== undefined)
        userData.sports = updateUserDto.sports;

      // ── Avatar upload ──────────────────────────────────────────────
      if (avatar?.buffer) {
        try {
          const safeName = avatar.originalname
            .toLowerCase()
            .replace(/[^a-z0-9.\s-_]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');

          const fileName = `${StringHelper.randomString()}-${safeName}`;
          const key = `${appConfig().storageUrl.avatar}/${fileName}`;

          await SazedStorage.put(key, avatar.buffer);
          userData.avatar = SazedStorage.url(encodeURI(key));

          // Delete old avatar if present
          const existingUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { avatar: true },
          });
          if (existingUser?.avatar) {
            try {
              const url = new URL(existingUser.avatar);
              await SazedStorage.delete(url.pathname.replace(/^\/+/, ''));
            } catch {
              await SazedStorage.delete(existingUser.avatar);
            }
          }
        } catch (err: any) {
          console.warn('Avatar upload failed:', err.message || err);
        }
      }

      // ── CoachProfile fields (coach only) ───────────────────────────
      if (user.type === 'coach') {
        const coachData: any = {};

        if (updateUserDto.primary_specialty !== undefined)
          coachData.primary_specialty = updateUserDto.primary_specialty;

        if (updateUserDto.experience_level !== undefined)
          coachData.experience_level = updateUserDto.experience_level;

        if (updateUserDto.hourly_rate !== undefined)
          coachData.hourly_rate = updateUserDto.hourly_rate;

        if (updateUserDto.session_price !== undefined)
          coachData.session_price = updateUserDto.session_price;

        if (updateUserDto.hourly_currency !== undefined)
          coachData.hourly_currency = updateUserDto.hourly_currency;

        if (updateUserDto.session_duration_minutes !== undefined) {
          const parsed = parseInt(
            String(updateUserDto.session_duration_minutes),
            10,
          );
          if (!isNaN(parsed)) coachData.session_duration_minutes = parsed;
        }

        if (updateUserDto.specialties !== undefined)
          coachData.specialties = this.parseStringArray(
            updateUserDto.specialties,
          );

        if (updateUserDto.certifications !== undefined)
          coachData.certifications = this.parseStringArray(
            updateUserDto.certifications,
          );

        // Mirror location/coordinates to coach profile as well
        if (updateUserDto.location !== undefined)
          coachData.location = updateUserDto.location;
        if (updateUserDto.latitude !== undefined)
          coachData.latitude = updateUserDto.latitude;
        if (updateUserDto.longitude !== undefined)
          coachData.longitude = updateUserDto.longitude;
        if (updateUserDto.languages !== undefined)
          coachData.languages = this.parseStringArray(updateUserDto.languages);

        if (Object.keys(coachData).length > 0) {
          await this.prisma.coachProfile.upsert({
            where: { user_id: userId },
            update: coachData,
            create: { user_id: userId, ...coachData },
          });
        }
      }

      // ── Update User model ──────────────────────────────────────────
      if (Object.keys(userData).length > 0) {
        await this.prisma.user.update({
          where: { id: userId },
          data: userData,
        });
      }

      return {
        success: true,
        message: 'Profile updated successfully',
        data: await UserRepository.getUserDetails(userId),
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(
        error?.message ?? 'Failed to update profile',
      );
    }
  }

  async setCoachProfileVisibility(userId: string, isVisible: boolean) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.type !== 'coach') {
        throw new BadRequestException(
          'Only coaches can have profile visibility settings',
        );
      }

      await this.prisma.coachProfile.update({
        where: { user_id: userId },
        data: { status: isVisible ? 1 : 0 },
      });

      return {
        success: true,
        message: 'Coach profile visibility updated successfully',
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException(
        error?.message ?? 'Failed to update coach profile visibility',
      );
    }
  }

  async validateUser(
    email: string,
    pass: string,
    token?: string,
  ): Promise<any> {
    const _password = pass;
    const user = await this.prisma.user.findFirst({
      where: {
        email: email,
      },
    });

    if (user) {
      const _isValidPassword = await UserRepository.validatePassword({
        email: email,
        password: _password,
      });
      if (_isValidPassword) {
        const { password, ...result } = user;
        if (user.is_two_factor_enabled) {
          if (token) {
            const isValid = await UserRepository.verify2FA(user.id, token);
            if (!isValid) {
              throw new UnauthorizedException('Invalid token');
              // return {
              //   success: false,
              //   message: 'Invalid token',
              // };
            }
          } else {
            throw new UnauthorizedException('Token is required');
            // return {
            //   success: false,
            //   message: 'Token is required',
            // };
          }
        }
        return result;
      } else {
        throw new UnauthorizedException('Password not matched');
        // return {
        //   success: false,
        //   message: 'Password not matched',
        // };
      }
    } else {
      throw new UnauthorizedException('Email not found');
      // return {
      //   success: false,
      //   message: 'Email not found',
      // };
    }
  }

  async login({ email, userId }) {
    try {
      const user = await UserRepository.getUserDetails(userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const payload = { email: email, sub: userId };

      const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
      const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

      // store refreshToken
      await this.redis.set(
        `refresh_token:${user.id}`,
        refreshToken,
        'EX',
        60 * 60 * 24 * 7, // 7 days in seconds
      );

      // Send login notification
      try {
        await this.notificationsService.sendNotification({
          type: NotificationType.USER_LOGGED_IN,
          recipient_id: user.id,
          variables: {
            user_name: user.name,
            login_time: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error('Failed to send login notification:', error);
      }

      return {
        success: true,
        message: 'Logged in successfully',
        authorization: {
          type: 'bearer',
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        type: user.type,
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to login');
    }
  }

  async setupProfile(userId: string, data: any) {
    try {
      if (userId == null || userId == undefined) {
        throw new NotFoundException('User not found');
      }

      // Fetch existing user data first
      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      // Build update object with only provided fields
      const userUpdateData: any = {};

      if (data.date_of_birth !== undefined) {
        userUpdateData.date_of_birth = data.date_of_birth;
        userUpdateData.age = DateHelper.calculateAge(data.date_of_birth);
      }

      if (data.bio !== undefined) userUpdateData.bio = data.bio;
      if (data.objectives !== undefined)
        userUpdateData.objectives = data.objectives;
      if (data.goals !== undefined) userUpdateData.goals = data.goals;
      if (data.sports !== undefined) userUpdateData.sports = data.sports;

      // Only update if there are fields to update
      const response =
        Object.keys(userUpdateData).length > 0
          ? await this.prisma.user.update({
              where: { id: userId },
              data: userUpdateData,
            })
          : existingUser;

      console.log('res.typ', response.type);

      // if user === coach, then setup coach profile as well
      if (response.type === 'coach') {
        console.log('hit');
        const checkPaymentStatus = await this.prisma.coachProfile.findFirst({
          where: { user_id: userId },
          select: { registration_fee_paid: true },
        });

        console.log(
          'checkPaymentStatus',
          checkPaymentStatus?.registration_fee_paid,
        );

        // get the coach profile id
        console.log('res.coachProfileId', checkPaymentStatus);

        if (checkPaymentStatus?.registration_fee_paid === 1) {
          console.log('Payment status is valid');

          // Build coach profile update object with only provided fields
          const coachUpdateData: any = { user_id: userId };

          if (data.primary_specialty !== undefined)
            coachUpdateData.primary_specialty = data.primary_specialty;
          if (data.specialties !== undefined)
            coachUpdateData.specialties = data.specialties;
          if (data.experience_level !== undefined)
            coachUpdateData.experience_level = data.experience_level;
          if (data.session_price !== undefined)
            coachUpdateData.session_price = data.session_price;
          if (data.session_duration_minutes !== undefined)
            coachUpdateData.session_duration_minutes =
              data.session_duration_minutes;
          if (data.certifications !== undefined)
            coachUpdateData.certifications = data.certifications;
          if (data.rgpd_laws_agreement !== undefined)
            coachUpdateData.rgpd_laws_agreement = data.rgpd_laws_agreement;

          coachUpdateData.hourly_currency = 'USD';

          // console.log('type checking', response.type);
          await this.prisma.coachProfile.upsert({
            where: { user_id: userId },
            update: coachUpdateData,
            create: {
              user_id: userId,
              primary_specialty: data.primary_specialty,
              specialties: data.specialties,
              experience_level: data.experience_level,
              session_price: data.session_price,
              hourly_currency: 'USD',
              session_duration_minutes: data.session_duration_minutes,
              certifications: data.certifications,
              rgpd_laws_agreement: data.rgpd_laws_agreement ?? false,
            },
          });

          return {
            success: true,
            message: 'Profile updated successfully',
          };
        } else {
          throw new BadRequestException(
            'Coach registration fee not paid. Please complete the payment to set up your profile.',
          );
        }
      }

      return {
        success: true,
        message: 'Profile updated successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to setup profile',
      );
    }
  }

  // // google log in using passport.js
  // async googleLogin({ email, userId }: { email: string; userId: string }) {
  //   try {
  //     const user = await UserRepository.getUserDetails(userId);

  //     if (!user) {
  //       throw new NotFoundException('User not found');
  //     }

  //     const payload = { email: email, sub: userId };

  //     const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
  //     const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

  //     await this.redis.set(
  //       `refresh_token:${user.id}`,
  //       refreshToken,
  //       'EX',
  //       60 * 60 * 24 * 7,
  //     );

  //     // create stripe customer account id
  //     try {
  //       const stripeCustomer = await StripePayment.createCustomer({
  //         user_id: user.id,
  //         email: user.email,
  //         name: `${user.first_name} ${user.last_name}`,
  //       });

  //       if (stripeCustomer) {
  //         await this.prisma.user.update({
  //           where: { id: user.id },
  //           data: { billing_id: stripeCustomer.id },
  //         });
  //       }
  //     } catch (error) {
  //       console.error('Failed to create Stripe customer:', error);
  //     }

  //     return {
  //       success: true,
  //       message: 'Logged in successfully',
  //       authorization: {
  //         type: 'bearer',
  //         access_token: accessToken,
  //         refresh_token: refreshToken,
  //       },
  //       type: user.type,
  //     };
  //   } catch (error) {
  //     // Re-throw NestJS exceptions
  //     if (error instanceof NotFoundException) {
  //       throw error;
  //     }
  //     // Throw generic error
  //     throw new BadRequestException(
  //       error?.message ?? 'Failed to login with Google',
  //     );
  //   }
  // }

  // // apple log in using passport.js
  // async appleLogin({
  //   email,
  //   userId,
  //   aud,
  // }: {
  //   email: string;
  //   userId: string;
  //   aud: string;
  // }) {
  //   try {
  //     const user = await UserRepository.getUserDetails(userId);

  //     if (!user) {
  //       throw new NotFoundException('User not found');
  //     }

  //     const payload = { email, sub: userId, aud };

  //     const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
  //     const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

  //     await this.redis.set(
  //       `refresh_token:${user.id}`,
  //       refreshToken,
  //       'EX',
  //       60 * 60 * 24 * 7,
  //     );

  //     // create stripe customer account id
  //     try {
  //       const stripeCustomer = await StripePayment.createCustomer({
  //         user_id: user.id,
  //         email: user.email,
  //         name: `${user.first_name} ${user.last_name}`,
  //       });

  //       if (stripeCustomer) {
  //         await this.prisma.user.update({
  //           where: { id: user.id },
  //           data: { billing_id: stripeCustomer.id },
  //         });
  //       }
  //     } catch (error) {
  //       console.error('Failed to create Stripe customer:', error);
  //     }

  //     return {
  //       success: true,
  //       message: 'Logged in successfully',
  //       authorization: {
  //         type: 'bearer',
  //         access_token: accessToken,
  //         refresh_token: refreshToken,
  //       },
  //       type: user.type,
  //     };
  //   } catch (error) {
  //     // Re-throw NestJS exceptions
  //     if (error instanceof NotFoundException) {
  //       throw error;
  //     }
  //     // Throw generic error
  //     throw new BadRequestException(
  //       error?.message ?? 'Failed to login with Apple',
  //     );
  //   }
  // }

  async refreshToken(user_id: string, refreshToken: string) {
    try {
      if (!user_id) {
        throw new NotFoundException('User not found');
      }

      const storedToken = await this.redis.get(`refresh_token:${user_id}`);

      if (!storedToken || storedToken != refreshToken) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const userDetails = await UserRepository.getUserDetails(user_id);
      if (!userDetails) {
        throw new NotFoundException('User not found');
      }

      const payload = { email: userDetails.email, sub: userDetails.id };
      const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });

      return {
        success: true,
        authorization: {
          type: 'bearer',
          access_token: accessToken,
        },
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (
        error instanceof UnauthorizedException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to refresh token',
      );
    }
  }

  async revokeRefreshToken(user_id: string) {
    try {
      const storedToken = await this.redis.get(`refresh_token:${user_id}`);
      if (!storedToken) {
        throw new NotFoundException('Refresh token not found');
      }

      await this.redis.del(`refresh_token:${user_id}`);

      return {
        success: true,
        message: 'Refresh token revoked successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to revoke refresh token',
      );
    }
  }

  async forgotPassword(email) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (!user) {
        throw new NotFoundException('Email not found');
      }

      const token = await UcodeRepository.createToken({
        userId: user.id,
        isOtp: true,
      });

      await this.mailService.sendOtpCodeToEmail({
        email: email,
        name: user.name,
        otp: token,
      });

      return {
        success: true,
        message: 'We have sent an OTP code to your email',
        otp: token, // For testing only - remove in production
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to send password reset email',
      );
    }
  }

  // verify otp
  async verifyOtp({ email, otp }) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (!user) {
        throw new NotFoundException('Email not found');
      }

      const existToken = await UcodeRepository.validateToken({
        email: email,
        token: otp,
      });

      if (!existToken) {
        throw new BadRequestException('Invalid OTP');
      }

      return {
        success: true,
        message: 'OTP verified successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to verify OTP');
    }
  }

  async resetPassword({ email, token, password }) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (!user) {
        throw new NotFoundException('Email not found');
      }

      const existToken = await UcodeRepository.validateToken({
        email: email,
        token: token,
      });

      if (!existToken) {
        throw new BadRequestException('Invalid token');
      }

      await UserRepository.changePassword({
        email: email,
        password: password,
      });

      // delete otp code
      await UcodeRepository.deleteToken({
        email: email,
        token: token,
      });

      return {
        success: true,
        message: 'Password updated successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to reset password',
      );
    }
  }

  async verifyEmail({ email, token }) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (!user) {
        throw new NotFoundException('Email not found');
      }

      const existToken = await UcodeRepository.validateToken({
        email: email,
        token: token,
      });

      if (!existToken) {
        throw new BadRequestException('Invalid token');
      }

      await this.prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          email_verified_at: new Date(Date.now()),
        },
      });

      return {
        success: true,
        message: 'Email verified successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to verify email');
    }
  }

  async resendVerificationEmail(email: string) {
    try {
      const user = await UserRepository.getUserByEmail(email);

      if (!user) {
        throw new NotFoundException('Email not found');
      }

      // create otp code
      const token = await UcodeRepository.createToken({
        userId: user.id,
        isOtp: true,
      });

      // send otp code to email
      await this.mailService.sendOtpCodeToEmail({
        email: email,
        name: user.name,
        otp: token,
      });

      return {
        success: true,
        message: 'We have sent a verification code to your email',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to resend verification email',
      );
    }
  }

  async changePassword({ user_id, oldPassword, newPassword }) {
    try {
      const user = await UserRepository.getUserDetails(user_id);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (oldPassword === newPassword) {
        throw new BadRequestException(
          'New password cannot be the same as old password',
        );
      }

      const _isValidPassword = await UserRepository.validatePassword({
        email: user.email,
        password: oldPassword,
      });

      if (!_isValidPassword) {
        throw new UnauthorizedException('Current password is incorrect');
      }

      await UserRepository.changePassword({
        email: user.email,
        password: newPassword,
      });

      // Send password change notification
      try {
        await this.notificationsService.sendNotification({
          type: NotificationType.PASSWORD_CHANGED,
          recipient_id: user_id,
          variables: {
            user_name: user.name,
          },
        });
      } catch (error) {
        console.error('Failed to send password change notification:', error);
      }

      return {
        success: true,
        message: 'Password updated successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to change password',
      );
    }
  }

  async requestEmailChange(user_id: string, email: string) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const token = await UcodeRepository.createToken({
        userId: user.id,
        isOtp: true,
        email: email,
      });

      await this.mailService.sendOtpCodeToEmail({
        email: email,
        name: email,
        otp: token,
      });

      return {
        success: true,
        message: 'We have sent an OTP code to your email',
        otp: token, // For testing only - remove in production
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to request email change',
      );
    }
  }

  async changeEmail({
    user_id,
    new_email,
    token,
  }: {
    user_id: string;
    new_email: string;
    token: string;
  }) {
    try {
      const user = await UserRepository.getUserDetails(user_id);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const existToken = await UcodeRepository.validateToken({
        email: user.email,
        token: token,
        forEmailChange: true,
      });

      if (!existToken) {
        throw new BadRequestException('Invalid token');
      }

      await UserRepository.changeEmail({
        user_id: user.id,
        new_email: new_email,
      });

      // delete otp code
      await UcodeRepository.deleteToken({
        email: new_email,
        token: token,
      });

      return {
        success: true,
        message: 'Email updated successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to change email');
    }
  }

  // --------- 2FA ---------
  async generate2FASecret(user_id: string) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return await UserRepository.generate2FASecret(user_id);
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(
        error?.message ?? 'Failed to generate 2FA secret',
      );
    }
  }

  async verify2FA(user_id: string, token: string) {
    try {
      const isValid = await UserRepository.verify2FA(user_id, token);
      if (!isValid) {
        throw new BadRequestException('Invalid token');
      }
      return {
        success: true,
        message: '2FA verified successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to verify 2FA');
    }
  }

  async enable2FA(user_id: string) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      await UserRepository.enable2FA(user_id);
      return {
        success: true,
        message: '2FA enabled successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to enable 2FA');
    }
  }

  async disable2FA(user_id: string) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      await UserRepository.disable2FA(user_id);
      return {
        success: true,
        message: '2FA disabled successfully',
      };
    } catch (error) {
      // Re-throw NestJS exceptions
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Throw generic error
      throw new BadRequestException(error?.message ?? 'Failed to disable 2FA');
    }
  }
  // --------- end 2FA ---------

  // ==================== social logins (google/apple) and related helper methods are below ====================

  async handleGoogleProfile(input: {
    googleId: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    avatar?: string | null;
    timezone?: string;
  }) {
    const googleId = input.googleId;
    const email = input.email?.toLowerCase?.() ?? undefined;
    const firstName = input.firstName ?? undefined;
    const lastName = input.lastName ?? undefined;
    const avatar = input.avatar ?? undefined;
    const timezone = input.timezone;

    if (!googleId) {
      throw new HttpException('googleId is required', HttpStatus.BAD_REQUEST);
    }

    // 1) Try by google_id first
    let user = await this.prisma.user.findUnique({
      where: { google_id: googleId },
    });

    // 2) If not found, try by email and link google_id
    if (!user && email) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (byEmail) {
        const enrichData: Prisma.UserUpdateInput = {
          google_id: byEmail.google_id ?? googleId,
          first_name: byEmail.first_name ?? firstName,
          last_name: byEmail.last_name ?? lastName,
          name:
            byEmail.name ??
            ([firstName, lastName].filter(Boolean).join(' ').trim() || null),
          avatar: byEmail.avatar ?? avatar,
          email_verified_at: byEmail.email_verified_at ?? new Date(),
        };

        try {
          user = await this.prisma.user.update({
            where: { id: byEmail.id },
            data: enrichData,
          });
        } catch (e: any) {
          if (e?.code === 'P2002') {
            throw new HttpException(
              'Google account is already linked to another user',
              HttpStatus.CONFLICT,
            );
          }
          throw e;
        }
      }
    }

    // 3) If still not found, create a new user
    if (!user) {
      const baseData: Prisma.UserCreateInput = {
        google_id: googleId,
        email: email,
        first_name: firstName,
        last_name: lastName,
        name: [firstName, lastName].filter(Boolean).join(' ').trim() || null,
        avatar: avatar,
        email_verified_at: email ? new Date() : undefined,
      };

      try {
        user = await this.prisma.user.create({ data: baseData });
      } catch (e: any) {
        // In case of a race (or unique constraint), recover by fetching the existing user.
        if (e?.code === 'P2002') {
          const existing = await this.prisma.user.findUnique({
            where: { google_id: googleId },
          });
          if (existing) {
            user = existing;
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }

    // IMPORTANT: For mobile login, enforce the same geo rules as normal login.
    const loginResponse = await this.login({
      email: user.email,
      userId: user.id,
    });

    return {
      success: true,
      statusCode: 200,
      message: loginResponse?.message ?? 'Logged in successfully',
      authorization: loginResponse?.authorization,
      type: loginResponse?.type ?? user?.type,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    };
  }

  async handleAppleProfile(input: {
    appleId: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    timezone?: string;
  }) {
    const appleId = input.appleId;
    const email = input.email?.toLowerCase?.() ?? undefined;
    const firstName = input.firstName ?? undefined;
    const lastName = input.lastName ?? undefined;
    const timezone = input.timezone;

    if (!appleId) {
      throw new HttpException('appleId is required', HttpStatus.BAD_REQUEST);
    }

    // Validate email format if provided
    if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      throw new HttpException('Invalid email format', HttpStatus.BAD_REQUEST);
    }

    // 1) Try by apple_id first
    let user = await this.prisma.user.findUnique({
      where: { apple_id: appleId },
    });

    // 2) If not found, try by email and link apple_id (best effort)
    if (!user && email) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (byEmail) {
        const enrichData: Prisma.UserUpdateInput = {
          apple_id: byEmail.apple_id ?? appleId,
          first_name: byEmail.first_name ?? firstName,
          last_name: byEmail.last_name ?? lastName,
          name:
            byEmail.name ??
            ([firstName, lastName].filter(Boolean).join(' ').trim() || null),
          email_verified_at: byEmail.email_verified_at ?? new Date(),
        };

        try {
          user = await this.prisma.user.update({
            where: { id: byEmail.id },
            data: enrichData,
          });
        } catch (e: any) {
          if (e?.code === 'P2002') {
            throw new HttpException(
              'Apple account is already linked to another user',
              HttpStatus.CONFLICT,
            );
          }
          throw e;
        }
      }
    }

    // 3) If still not found, create a new user
    if (!user) {
      let resolvedEmail = email ?? `apple_${appleId}@appleid.local`;

      // Check if email already exists (for placeholder emails)
      if (!email) {
        const existingWithEmail = await this.prisma.user.findUnique({
          where: { email: resolvedEmail },
        });
        if (existingWithEmail) {
          // Generate unique placeholder email
          resolvedEmail = `apple_${appleId}_${StringHelper.randomString(8)}@appleid.local`;
        }
      }

      const baseData: Prisma.UserCreateInput = {
        apple_id: appleId,
        email: resolvedEmail,
        first_name: firstName,
        last_name: lastName,
        name: [firstName, lastName].filter(Boolean).join(' ').trim() || null,
        email_verified_at: new Date(),
      };

      try {
        user = await this.prisma.user.create({ data: baseData });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          // If this was a race on apple_id, recover by fetching.
          const existing = await this.prisma.user.findUnique({
            where: { apple_id: appleId },
          });
          if (existing) {
            user = existing;
          } else {
            // If the generated placeholder email still collides, make it more unique.
            baseData.email = `apple_${appleId}_${StringHelper.randomString(12)}@appleid.local`;
            user = await this.prisma.user.create({ data: baseData });
          }
        } else {
          throw e;
        }
      }
    }

    const loginResponse = await this.login({
      email: user.email,
      userId: user.id,
    });

    return {
      success: true,
      statusCode: 200,
      message: loginResponse?.message ?? 'Logged in successfully',
      authorization: loginResponse?.authorization,
      type: loginResponse?.type ?? user?.type,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    };
  }
}
