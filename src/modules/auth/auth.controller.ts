import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import appConfig from '../../config/app.config';
import { AuthGuard } from '@nestjs/passport';
import { AppleAuthGuard } from './guards/apple-auth.guard';
import { CreateCoachProfileDto } from './dto/create-coach-profile.dto';
import { GoogleMobileDto } from './dto/google-mobile.dto';
import { AppleMobileDto } from './dto/apple-mobile.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Get user details' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    try {
      // console.log(req.user);
      const user_id = req.user.userId;

      const response = await this.authService.me(user_id);

      return response;
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to fetch user details',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // @ApiOperation({ summary: 'Register a user (legacy - use two-step flow instead)' })
  // @Post('register')
  // @UseInterceptors(
  //   FileInterceptor('avatar', {
  //     storage: memoryStorage(),
  //   }),
  // )
  // async create(
  //   @Body() data: CreateUserDto,

  //   @UploadedFile() avatar?: Express.Multer.File,
  // ) {
  //   try {
  //     const name = data.name;
  //     const email = data.email;
  //     const password = data.password;
  //     const location = data.location;
  //     const latitude = data.latitude;
  //     const longitude = data.longitude;
  //     const type = data.type;
  //     const phone_number = data.phone_number;
  //     const date_of_birth = data.date_of_birth;
  //     const bio = data.bio;
  //     const avatarFile = avatar;

  //     if (!name) {
  //       throw new HttpException('Name not provided', HttpStatus.UNAUTHORIZED);
  //     }

  //     if (!email) {
  //       throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
  //     }
  //     if (!password) {
  //       throw new HttpException(
  //         'Password not provided',
  //         HttpStatus.UNAUTHORIZED,
  //       );
  //     }

  //     console.log('avatar in controller', avatar);

  //     const response = await this.authService.register({
  //       name: name,
  //       email: email,
  //       phone_number: phone_number,
  //       location: location,
  //       latitude: latitude,
  //       longitude: longitude,
  //       date_of_birth: date_of_birth,
  //       password: password,
  //       bio: bio,
  //       type: type,
  //       avatar: avatarFile,
  //     });

  //     return response;
  //   } catch (error) {
  //     if (error instanceof HttpException) {
  //       throw error;
  //     }
  //     throw new HttpException(error?.message, HttpStatus.BAD_REQUEST);
  //   }
  // }

  @ApiOperation({ summary: 'Step 1: Request registration and send OTP' })
  @Post('register/request')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
    }),
  )
  async requestRegistration(
    @Body() data: CreateUserDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    try {
      if (!data.name) {
        throw new HttpException('Name not provided', HttpStatus.BAD_REQUEST);
      }
      if (!data.email) {
        throw new HttpException('Email not provided', HttpStatus.BAD_REQUEST);
      }
      if (!data.password) {
        throw new HttpException(
          'Password not provided',
          HttpStatus.BAD_REQUEST,
        );
      }

      const response = await this.authService.requestRegistration({
        name: data.name,
        email: data.email,
        phone_number: data.phone_number,
        location: data.location,
        latitude: data.latitude,
        longitude: data.longitude,
        date_of_birth: data.date_of_birth,
        password: data.password,
        bio: data.bio,
        type: data.type,
        avatar: avatar,
      });

      return response;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(error?.message, HttpStatus.BAD_REQUEST);
    }
  }

  @ApiOperation({ summary: 'Step 2: Verify OTP and complete registration' })
  @Post('register/verify')
  async verifyAndRegister(@Body() data: { email: string; otp: string }) {
    try {
      if (!data.email) {
        throw new HttpException('Email not provided', HttpStatus.BAD_REQUEST);
      }
      if (!data.otp) {
        throw new HttpException('OTP not provided', HttpStatus.BAD_REQUEST);
      }

      const response = await this.authService.verifyAndRegister({
        email: data.email,
        otp: data.otp,
      });

      return response;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(error?.message, HttpStatus.BAD_REQUEST);
    }
  }

  // login user
  @ApiOperation({ summary: 'Login user' })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Req() req: Request, @Res() res: Response) {
    try {
      // console.log("user", req.user);
      const user_id = req.user.id;

      const user_email = req.user.email;

      const response = await this.authService.login({
        userId: user_id,
        email: user_email,
      });

      // store to secure cookies
      res.cookie('refresh_token', response.authorization.refresh_token, {
        httpOnly: true,
        secure: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      });

      res.json(response);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to login',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // setup profile
  @ApiOperation({ summary: 'Setup user profile' })
  @UseGuards(JwtAuthGuard)
  @Post('setup-profile')
  async setupProfile(@Req() req: Request, @Body() data: any) {
    try {
      const user_id = req.user.userId;

      const response = await this.authService.setupProfile(user_id, data);

      return response;
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to setup profile',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // profile visibility setting for coaches
  @ApiOperation({ summary: 'Set coach profile visibility' })
  @UseGuards(JwtAuthGuard)
  @Post('coach-profile-visibility')
  async setCoachProfileVisibility(
    @Req() req: Request,
    @Body() data: { is_visible: boolean },
  ) {
    try {
      const user_id = req.user.userId;
      const is_visible = data.is_visible;
      const response = await this.authService.setCoachProfileVisibility(
        user_id,
        is_visible,
      );
      return response;
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to set coach profile visibility',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Get coach profile visibility' })
  @UseGuards(JwtAuthGuard)
  @Get('coach-profile-visibility')
  async getCoachProfileVisibility(@Req() req: Request) {
    try {
      const user_id = req.user.userId;
      const response =
        await this.authService.getCoachProfileVisibility(user_id);
      return response;
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to get coach profile visibility',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Refresh token' })
  @ApiBearerAuth()
  // @UseGuards(JwtAuthGuard)
  @Post('refresh-token')
  async refreshToken(
    @Req() req: Request,
    @Body() body: { refresh_token: string },
  ) {
    try {
      // const user_id = req.user.userId;

      const response = await this.authService.refreshToken(
        // user_id,
        body.refresh_token,
      );

      return response;
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to refresh token',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: Request) {
    try {
      const userId = req.user.userId;
      const response = await this.authService.revokeRefreshToken(userId);
      return response;
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to logout',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // update user
  @ApiOperation({ summary: 'Update user' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('update')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
    }),
  )
  async updateUser(
    @Req() req: Request,
    @Body() data: UpdateUserDto,
    @UploadedFile() avatar: Express.Multer.File,
  ) {
    try {
      const user_id = req.user.userId;
      const response = await this.authService.updateUser(user_id, data, avatar);
      console.log('user_id', user_id);
      console.log('data', data);
      console.log('avatar', avatar);
      console.log('response', response);
      return response;
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to update user',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // --------------change password---------

  @ApiOperation({ summary: 'Forgot password' })
  @Post('forgot-password')
  async forgotPassword(@Body() data: { email: string }) {
    try {
      const email = data.email;
      if (!email) {
        throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
      }
      return await this.authService.forgotPassword(email);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to send password reset email',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // verify email to verify the email
  @ApiOperation({ summary: 'Verify email' })
  @Post('verify-email')
  async verifyEmail(@Body() data: VerifyEmailDto) {
    try {
      const email = data.email;
      const token = data.otp;
      if (!email) {
        throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
      }
      if (!token) {
        throw new HttpException('Token not provided', HttpStatus.UNAUTHORIZED);
      }
      return await this.authService.verifyEmail({
        email: email,
        token: token,
      });
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to verify email',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // resend verification email to verify the email
  @ApiOperation({ summary: 'Resend verification email' })
  @Post('resend-verification-email')
  async resendVerificationEmail(@Body() data: { email: string }) {
    try {
      const email = data.email;
      if (!email) {
        throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
      }
      return await this.authService.resendVerificationEmail(email);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to resend verification email',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // reset password if user forget the password
  @ApiOperation({ summary: 'Reset password' })
  @Post('reset-password')
  async resetPassword(
    @Body() data: { email: string; otp: string; new_password: string },
  ) {
    try {
      const email = data.email;
      const token = data.otp;
      const password = data.new_password;
      if (!email) {
        throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
      }
      if (!token) {
        throw new HttpException('Token not provided', HttpStatus.UNAUTHORIZED);
      }
      if (!password) {
        throw new HttpException(
          'Password not provided',
          HttpStatus.UNAUTHORIZED,
        );
      }
      return await this.authService.resetPassword({
        email: email,
        token: token,
        password: password,
      });
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to reset password',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // change password if user want to change the password
  @ApiOperation({ summary: 'Change password' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Req() req: Request,
    @Body() data: { email: string; old_password: string; new_password: string },
  ) {
    try {
      // const email = data.email;
      const user_id = req.user.userId;

      const oldPassword = data.old_password;
      const newPassword = data.new_password;
      // if (!email) {
      //   throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
      // }
      if (!oldPassword) {
        throw new HttpException(
          'Old password not provided',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (!newPassword) {
        throw new HttpException(
          'New password not provided',
          HttpStatus.UNAUTHORIZED,
        );
      }
      return await this.authService.changePassword({
        // email: email,
        user_id: user_id,
        oldPassword: oldPassword,
        newPassword: newPassword,
      });
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to change password',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // --------------end change password---------

  // -------change email address------
  @ApiOperation({ summary: 'request email change' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('request-email-change')
  async requestEmailChange(
    @Req() req: Request,
    @Body() data: { email: string },
  ) {
    try {
      const user_id = req.user.userId;
      const email = data.email;
      if (!email) {
        throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
      }
      return await this.authService.requestEmailChange(user_id, email);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to request email change',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Change email address' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('change-email')
  async changeEmail(
    @Req() req: Request,
    @Body() data: { email: string; token: string },
  ) {
    try {
      const user_id = req.user.userId;
      const email = data.email;

      const token = data.token;
      if (!email) {
        throw new HttpException('Email not provided', HttpStatus.UNAUTHORIZED);
      }
      if (!token) {
        throw new HttpException('Token not provided', HttpStatus.UNAUTHORIZED);
      }
      return await this.authService.changeEmail({
        user_id: user_id,
        new_email: email,
        token: token,
      });
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to change email',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  // -------end change email address------

  // --------- 2FA ---------
  @ApiOperation({ summary: 'Generate 2FA secret' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('generate-2fa-secret')
  async generate2FASecret(@Req() req: Request) {
    try {
      const user_id = req.user.userId;
      return await this.authService.generate2FASecret(user_id);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to generate 2FA secret',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Verify 2FA' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('verify-2fa')
  async verify2FA(@Req() req: Request, @Body() data: { token: string }) {
    try {
      const user_id = req.user.userId;
      const token = data.token;
      return await this.authService.verify2FA(user_id, token);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to verify 2FA',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Enable 2FA' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('enable-2fa')
  async enable2FA(@Req() req: Request) {
    try {
      const user_id = req.user.userId;
      return await this.authService.enable2FA(user_id);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to enable 2FA',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @ApiOperation({ summary: 'Disable 2FA' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('disable-2fa')
  async disable2FA(@Req() req: Request) {
    try {
      const user_id = req.user.userId;
      return await this.authService.disable2FA(user_id);
    } catch (error) {
      // Re-throw HttpException to preserve status codes
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error?.message ?? 'Failed to disable 2FA',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  // --------- end 2FA ---------

  // ======================================== mobile only google login (Flutter) ==============================================
  @ApiOperation({ summary: 'Google login (mobile - Flutter idToken)' })
  @Post('google/mobile')
  @UseGuards(AuthGuard('google-mobile'))
  async googleMobile(@Req() req: Request, @Body() _body: GoogleMobileDto) {
    // passport-custom strategy returns the final payload as req.user
    return req.user;
  }

  @ApiOperation({ summary: 'Apple login (mobile - Flutter identityToken)' })
  @Post('apple/mobile')
  @UseGuards(AuthGuard('apple-mobile'))
  async appleMobile(@Req() req: Request, @Body() _body: AppleMobileDto) {
    // passport-custom strategy returns the final payload as req.user
    return req.user;
  }
}
