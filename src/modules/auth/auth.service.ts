// external imports
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

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

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mailService: MailService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async me(userId: string) {
    try {
      const user = await (this.prisma as any).user.findFirst({
        where: {
          id: userId,
        },
        select: {
          id: true,
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
            },
          },
        },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      if (user) {
        return {
          success: true,
          data: user,
        };
      } else {
        return {
          success: false,
          message: 'User not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async register({
    name,
    email,
    phone_number,
    location,
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
    phone_number: string;
    type?: string;
    bio?: string;
    date_of_birth?: string;
    coach_profile?: any;
    avatar?: Express.Multer.File;
  }) {
    try {
      // Check if email already exist
      const userEmailExist = await UserRepository.exist({
        field: 'email',
        value: String(email),
      });

      if (userEmailExist) {
        return {
          statusCode: 401,
          message: 'Email already exist',
        };
      }

      let mediaUrl: string | undefined = undefined;

      if (avatar?.buffer) {
        try {
          const fileName = `${StringHelper.randomString()}${avatar.originalname}`;
          await SazedStorage.put(
            appConfig().storageUrl.avatar + '/' + fileName,
            avatar.buffer,
          );
          console.log('fileName: ', fileName);

          // set avatar url
          mediaUrl = SazedStorage.url(
            appConfig().storageUrl.avatar + '/' + fileName,
          );
        } catch (error) {
          console.error('Failed to upload avatar:', error);
          throw new Error(`Failed to upload avatar: ${error.message}`);
        }
      }

      const user = await UserRepository.createUser({
        name: name,
        email: email,
        phone_number: phone_number,
        location: location,
        bio: bio,
        date_of_birth: date_of_birth,
        age: DateHelper.calculateAge(date_of_birth),
        password: password,
        type: type,
        avatar: mediaUrl,
      });

      if (user == null && user.success == false) {
        return {
          success: false,
          message: 'Failed to create account',
        };
      }

      // create stripe customer account
      const stripeCustomer = await StripePayment.createCustomer({
        user_id: user.data.id,
        email: email,
        name: name,
      });

      if (stripeCustomer) {
        await this.prisma.user.update({
          where: {
            id: user.data.id,
          },
          data: {
            billing_id: stripeCustomer.id,
          },
        });
      }

      // // If registering as a coach, create the coach profile record
      // if (type === 'coach' && coach_profile) {
      //   console.log('type is coach or not', type);

      //   try {
      //     await this.prisma.coachProfile.create({
      //       data: {
      //         user_id: user.data.id,
      //         hourly_rate: coach_profile.hourly_rate ?? undefined,
      //         hourly_currency: coach_profile.hourly_currency ?? null,
      //       },
      //     });
      //   } catch (err) {
      //     return {
      //       success: false,
      //       message:
      //         'User created but failed to create coach profile: ' + err.message,
      //     };
      //   }
      //   return {
      //     success: true,
      //     message: 'We have sent a verification link to your email',
      //   };
      // }

      // Generate verification token
      // const token = await UcodeRepository.createVerificationToken({
      //   userId: user.data.id,
      //   email: email,
      // });

      // // Send verification email with token
      // await this.mailService.sendVerificationLink({
      //   email,
      //   name: email,
      //   token: token.token,
      //   type: type,
      // });

      return {
        success: true,
        message: 'Registered successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async updateUser(
    userId: string,
    updateUserDto: UpdateUserDto,
    avatar?: Express.Multer.File,
  ) {
    try {
      const data: any = {};
      if (updateUserDto.name) {
        data.name = updateUserDto.name;
      }
      if (updateUserDto.phone_number) {
        data.phone_number = updateUserDto.phone_number;
      }
      if (updateUserDto.location) {
        data.location = updateUserDto.location;
      }
      if (updateUserDto.date_of_birth) {
        data.date_of_birth = DateHelper.format(updateUserDto.date_of_birth);
      }
      if (updateUserDto.gender) {
        data.gender = updateUserDto.gender;
      }
      if (updateUserDto.bio) {
        data.bio = updateUserDto.bio;
      }
      if (updateUserDto.objectives) {
        data.objectives = updateUserDto.objectives;
      }

      // athlete profile fields
      if (updateUserDto.primary_specialty) {
        data.primary_specialty = updateUserDto.primary_specialty;
      }
      if (updateUserDto.specialties) {
        data.specialties = updateUserDto.specialties;
      }

      let mediaUrl: string | undefined;

      if (avatar?.buffer) {
        try {
          // 1. Upload new avatar
          const fileName = `${StringHelper.randomString()}-${avatar.originalname}`;
          const key = `${appConfig().storageUrl.avatar}/${fileName}`;

          await SazedStorage.put(key, avatar.buffer);
          mediaUrl = SazedStorage.url(key);

          // 2. Get old avatar (if any)
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { avatar: true },
          });

          // 3. Delete old avatar if exists and is not empty
          if (user?.avatar) {
            try {
              // If avatar stored is a full URL -> extract its path
              const url = new URL(user.avatar);
              const oldKey = url.pathname.replace(/^\/+/, ''); // remove leading slash

              await SazedStorage.delete(oldKey);
            } catch {
              // If it wasn't a URL, assume it is the actual storage key
              await SazedStorage.delete(user.avatar);
            }
          }

          // 4. Update user's avatar
          data.avatar = mediaUrl;
        } catch (err: any) {
          console.warn('Avatar upload failed:', err.message || err);
        }
      }

      const user = await UserRepository.getUserDetails(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // If user is a coach, update coach profile fields via upsert
      if (user.type === 'coach') {
        await this.prisma.coachProfile.upsert({
          where: { user_id: userId },
          update: {
            primary_specialty: data.primary_specialty,
            specialties: data.specialties,
          },
          create: {
            user_id: userId,
            primary_specialty: data.primary_specialty,
            specialties: data.specialties,
          },
        });
      }

      // non-coach (athlete) update path
      await (this.prisma as any).user.update({
        where: { id: userId },
        data: { ...data },
      });

      return {
        success: true,
        message: 'Profile updated successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
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
      const payload = { email: email, sub: userId };

      const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
      const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

      const user = await UserRepository.getUserDetails(userId);

      // store refreshToken
      await this.redis.set(
        `refresh_token:${user.id}`,
        refreshToken,
        'EX',
        60 * 60 * 24 * 7, // 7 days in seconds
      );

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
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async setupProfile(userId: string, data: any) {
    try {
      if (userId == null || userId == undefined) {
        throw new Error('User not found');
      }

      const response = await this.prisma.user.update({
        where: { id: userId },
        data: {
          date_of_birth: data.date_of_birth,
          age: DateHelper.calculateAge(data.date_of_birth),
          bio: data.bio,
          objectives: data.objectives,
          goals: data.goals,
          sports: data.sports,
        },
      });

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

        // if (checkPaymentStatus?.registration_fee_paid === 1) {
        //   console.log('Payment status is valid');

        //   // console.log('type checking', response.type);
        //   await this.prisma.coachProfile.upsert({
        //     where: { user_id: userId },
        //     update: {
        //       bio: data.bio,
        //       specialty: data.specialty,
        //       experience_level: data.experience_level,
        //       certifications: data.certifications,
        //       rgpd_laws_agreement: data.rgpd_laws_agreement ?? false,
        //     },
        //     create: {
        //       user_id: userId,
        //       bio: data.bio,
        //       specialty: data.specialty,
        //       experience_level: data.experience_level,
        //       certifications: data.certifications,
        //       rgpd_laws_agreement: data.rgpd_laws_agreement ?? false,
        //     },
        //   });

        //   return {
        //     success: true,
        //     message: 'Profile updated successfully',
        //   };
        // } else {
        //   return {
        //     success: false,
        //     message:
        //       'Coach registration fee not paid. Please complete the payment to set up your profile.',
        //   };
        // }

        await this.prisma.coachProfile.upsert({
          where: { user_id: userId },
          update: {
            primary_specialty: data.primary_specialty,
            specialties: data.specialties,
            experience_level: data.experience_level,
            session_price: data.session_price,
            hourly_currency: 'USD',
            session_duration_minutes: data.session_duration_minutes,
            certifications: data.certifications,
            rgpd_laws_agreement: data.rgpd_laws_agreement ?? false,
          },
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
      }

      return {
        success: true,
        message: 'Profile updated successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // google log in using passport.js
  async googleLogin({ email, userId }: { email: string; userId: string }) {
    try {
      const payload = { email: email, sub: userId };

      const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
      const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

      const user = await UserRepository.getUserDetails(userId);

      await this.redis.set(
        `refresh_token:${user.id}`,
        refreshToken,
        'EX',
        60 * 60 * 24 * 7,
      );

      // create stripe customer account id
      try {
        const stripeCustomer = await StripePayment.createCustomer({
          user_id: user.id,
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
        });

        if (stripeCustomer) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { billing_id: stripeCustomer.id },
          });
        }
      } catch (error) {
        return {
          success: false,
          message: 'User created but failed to create billing account',
        };
      }

      return {
        message: 'Logged in successfully',
        authorization: {
          type: 'bearer',
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        type: user.type,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // apple log in using passport.js
  async appleLogin({
    email,
    userId,
    aud,
  }: {
    email: string;
    userId: string;
    aud: string;
  }) {
    try {
      const payload = { email, sub: userId, aud };

      const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
      const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

      const user = await UserRepository.getUserDetails(userId);

      await this.redis.set(
        `refresh_token:${user.id}`,
        refreshToken,
        'EX',
        60 * 60 * 24 * 7,
      );

      // create stripe customer account id
      try {
        const stripeCustomer = await StripePayment.createCustomer({
          user_id: user.id,
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
        });

        if (stripeCustomer) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { billing_id: stripeCustomer.id },
          });
        }
      } catch (error) {
        return {
          success: false,
          message: 'User created but failed to create billing account',
        };
      }

      return {
        message: 'Logged in successfully',
        authorization: {
          type: 'bearer',
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        type: user.type,
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async refreshToken(user_id: string, refreshToken: string) {
    try {
      const storedToken = await this.redis.get(`refresh_token:${user_id}`);

      if (!storedToken || storedToken != refreshToken) {
        return {
          success: false,
          message: 'Refresh token is required',
        };
      }

      if (!user_id) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      const userDetails = await UserRepository.getUserDetails(user_id);
      if (!userDetails) {
        return {
          success: false,
          message: 'User not found',
        };
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
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async revokeRefreshToken(user_id: string) {
    try {
      const storedToken = await this.redis.get(`refresh_token:${user_id}`);
      if (!storedToken) {
        return {
          success: false,
          message: 'Refresh token not found',
        };
      }

      await this.redis.del(`refresh_token:${user_id}`);

      return {
        success: true,
        message: 'Refresh token revoked successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async forgotPassword(email) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (user) {
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
        };
      } else {
        return {
          success: false,
          message: 'Email not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // verify otp
  async verifyOtp({ email, otp }) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (user) {
        const existToken = await UcodeRepository.validateToken({
          email: email,
          token: otp,
        });

        if (existToken) {
          return {
            success: true,
            message: 'OTP verified successfully',
          };
        } else {
          return {
            success: false,
            message: 'Invalid OTP',
          };
        }
      } else {
        return {
          success: false,
          message: 'Email not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async resetPassword({ email, token, password }) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (user) {
        const existToken = await UcodeRepository.validateToken({
          email: email,
          token: token,
        });

        if (existToken) {
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
        } else {
          return {
            success: false,
            message: 'Invalid token',
          };
        }
      } else {
        return {
          success: false,
          message: 'Email not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async verifyEmail({ email, token }) {
    try {
      const user = await UserRepository.exist({
        field: 'email',
        value: email,
      });

      if (user) {
        const existToken = await UcodeRepository.validateToken({
          email: email,
          token: token,
        });

        if (existToken) {
          await this.prisma.user.update({
            where: {
              id: user.id,
            },
            data: {
              email_verified_at: new Date(Date.now()),
            },
          });

          // delete otp code
          // await UcodeRepository.deleteToken({
          //   email: email,
          //   token: token,
          // });

          return {
            success: true,
            message: 'Email verified successfully',
          };
        } else {
          return {
            success: false,
            message: 'Invalid token',
          };
        }
      } else {
        return {
          success: false,
          message: 'Email not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async resendVerificationEmail(email: string) {
    try {
      const user = await UserRepository.getUserByEmail(email);

      if (user) {
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
      } else {
        return {
          success: false,
          message: 'Email not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async changePassword({ user_id, oldPassword, newPassword }) {
    try {
      const user = await UserRepository.getUserDetails(user_id);

      if (user) {
        const _isValidPassword = await UserRepository.validatePassword({
          email: user.email,
          password: oldPassword,
        });
        if (_isValidPassword) {
          await UserRepository.changePassword({
            email: user.email,
            password: newPassword,
          });

          return {
            success: true,
            message: 'Password updated successfully',
          };
        } else {
          return {
            success: false,
            message: 'Invalid password',
          };
        }
      } else {
        return {
          success: false,
          message: 'Email not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async requestEmailChange(user_id: string, email: string) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (user) {
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
        };
      } else {
        return {
          success: false,
          message: 'User not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
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

      if (user) {
        const existToken = await UcodeRepository.validateToken({
          email: new_email,
          token: token,
          forEmailChange: true,
        });

        if (existToken) {
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
        } else {
          return {
            success: false,
            message: 'Invalid token',
          };
        }
      } else {
        return {
          success: false,
          message: 'User not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // --------- 2FA ---------
  async generate2FASecret(user_id: string) {
    try {
      return await UserRepository.generate2FASecret(user_id);
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async createCoachRegistrationPayment(
    user_id: string,
    amount = 49,
    currency = 'usd',
  ) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (!user) return { success: false, message: 'User not found' };
      // Determine whether the registration fee has already been paid
      const coachProfile = await (this.prisma as any).coachProfile.findFirst({
        where: { user_id: user.id },
      });

      const registrationFee =
        appConfig().payment.registration.coach_registration_fee ?? 10;
      const subscriptionFee =
        appConfig().payment.registration.coach_subscription_fee ?? 49;

      let totalAmount = amount; // default if caller overrides
      let txType = 'subscription';
      let metadataType = 'coach_subscription';

      const bodyAmountOrDefault = (bodyAmt: any, fallback: number) => {
        if (typeof bodyAmt === 'number' && bodyAmt > 0) return bodyAmt;
        return fallback;
      };

      if (!coachProfile || !coachProfile.registration_fee_paid) {
        // first-time payment: registration + first-month subscription
        totalAmount = bodyAmountOrDefault(
          amount,
          registrationFee + subscriptionFee,
        );
        txType = 'registration_and_subscription';
        metadataType = 'coach_registration_and_subscription';
      } else {
        // subsequent payments: subscription only
        totalAmount = bodyAmountOrDefault(amount, subscriptionFee);
        txType = 'subscription';
        metadataType = 'coach_subscription';
      }

      // ensure stripe customer exists
      if (!user.billing_id) {
        const stripeCustomer = await StripePayment.createCustomer({
          user_id: user.id,
          email: user.email,
          name: user.name || `${user.first_name || ''} ${user.last_name || ''}`,
        });
        if (stripeCustomer) {
          await (this.prisma as any).user.update({
            where: { id: user.id },
            data: { billing_id: stripeCustomer.id },
          });
          user.billing_id = stripeCustomer.id;
        }
      }

      // create payment intent for calculated amount
      const paymentIntent = await StripePayment.createPaymentIntent({
        amount: totalAmount,
        currency: currency,
        customer_id: user.billing_id,
        metadata: { user_id: user.id, type: metadataType },
      });

      // store single transaction representing this checkout
      await (this.prisma as any).paymentTransaction.create({
        data: {
          user_id: user.id,
          amount: totalAmount,
          currency: currency,
          provider: 'stripe',
          reference_number: paymentIntent.id,
          status: 'pending',
          type: txType,
        },
      });

      return {
        success: true,
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async verify2FA(user_id: string, token: string) {
    try {
      const isValid = await UserRepository.verify2FA(user_id, token);
      if (!isValid) {
        return {
          success: false,
          message: 'Invalid token',
        };
      }
      return {
        success: true,
        message: '2FA verified successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async enable2FA(user_id: string) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (user) {
        await UserRepository.enable2FA(user_id);
        return {
          success: true,
          message: '2FA enabled successfully',
        };
      } else {
        return {
          success: false,
          message: 'User not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async disable2FA(user_id: string) {
    try {
      const user = await UserRepository.getUserDetails(user_id);
      if (user) {
        await UserRepository.disable2FA(user_id);
        return {
          success: true,
          message: '2FA disabled successfully',
        };
      } else {
        return {
          success: false,
          message: 'User not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
  // --------- end 2FA ---------
}
