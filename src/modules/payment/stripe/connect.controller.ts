import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';

@Controller('payment/stripe/connect')
@UseGuards(JwtAuthGuard)
export class ConnectController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('onboard')
  async onboard(@Req() req) {
    if (!req.user?.userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, type: true },
    });
    if (!user) throw new BadRequestException('User not found');
    if (user.type !== 'coach') {
      throw new HttpException(
        'Only coaches can onboard for payouts',
        HttpStatus.FORBIDDEN,
      );
    }

    let coachProfile = await this.prisma.coachProfile.findFirst({
      where: { user_id: user.id },
      select: { id: true, stripe_account_id: true },
    });

    if (!coachProfile) {
      throw new BadRequestException('Coach profile not found');
    }

    let accountId = coachProfile.stripe_account_id;
    if (!accountId) {
      const account = await StripePayment.createConnectedAccount(user.email || '');
      accountId = account.id;
      await this.prisma.coachProfile.update({
        where: { id: coachProfile.id },
        data: {
          stripe_account_id: accountId,
          stripe_account_status: 'pending',
        },
      });
    }

    const link = await StripePayment.createOnboardingAccountLink(accountId);

    return {
      success: true,
      account_id: accountId,
      url: link.url,
      expires_at: link.expires_at,
    };
  }

  @Get('status')
  async status(@Req() req) {
    if (!req.user?.userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    const coachProfile = await this.prisma.coachProfile.findFirst({
      where: { user_id: req.user.userId },
      select: { id: true, stripe_account_id: true, stripe_account_status: true },
    });

    if (!coachProfile?.stripe_account_id) {
      return {
        success: true,
        connected: false,
      };
    }

    const account = await StripePayment.retrieveConnectedAccount(
      coachProfile.stripe_account_id,
    );

    const connected = !!account.charges_enabled && !!account.payouts_enabled;
    const status = connected ? 'complete' : 'pending';

    if (coachProfile.stripe_account_status !== status) {
      await this.prisma.coachProfile.update({
        where: { id: coachProfile.id },
        data: { stripe_account_status: status },
      });
    }

    return {
      success: true,
      connected,
      account_id: coachProfile.stripe_account_id,
      status,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
    };
  }
}
