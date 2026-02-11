import { Controller, Get, Post, Body, Param, UseGuards, Req, HttpException, HttpStatus, BadRequestException, Query } from '@nestjs/common';
import { SubscriptionService } from '../subscription.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';

@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('plans')
  @UseGuards(JwtAuthGuard)
  async getAllPlans(@Query('kind') kind?: string) {
    try {
      return await this.subscriptionService.getAllPlans(kind);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch subscription plans',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  async createCheckout(@Body() body: { plan_id: string }, @Req() req) {
    try {
      if (!body || !body.plan_id) {
        throw new BadRequestException('plan_id is required');
      }
      if (!req.user || !req.user.userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      return await this.subscriptionService.createSubscriptionCheckout({
        user_id: req.user.userId,
        plan_id: body.plan_id,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to create checkout session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('coach/checkout')
  @UseGuards(JwtAuthGuard)
  async createCoachCheckout(@Body() body: { plan_id: string }, @Req() req) {
    try {
      if (!body || !body.plan_id) {
        throw new BadRequestException('plan_id is required');
      }
      if (!req.user || !req.user.userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      return await this.subscriptionService.createSubscriptionCheckout({
        user_id: req.user.userId,
        plan_id: body.plan_id,
        enforce_coach: true,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to create checkout session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('athlete/checkout')
  @UseGuards(JwtAuthGuard)
  async createAthleteCheckout(@Body() body: { plan_id: string }, @Req() req) {
    try {
      if (!body || !body.plan_id) {
        throw new BadRequestException('plan_id is required');
      }
      if (!req.user || !req.user.userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      return await this.subscriptionService.createSubscriptionCheckout({
        user_id: req.user.userId,
        plan_id: body.plan_id,
        enforce_athlete: true,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to create checkout session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('current')
  @UseGuards(JwtAuthGuard)
  async getCurrentSubscription(@Req() req, @Query('kind') kind?: string) {
    try {
      if (!req.user || !req.user.userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }
      
      const result = await this.subscriptionService.getUserSubscription(
        req.user.userId,
        kind,
      );
      
      // This will always return a proper response
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to get current subscription',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  async cancelSubscription(
    @Body() body: { cancel_immediately?: boolean; kind?: string },
    @Req() req,
  ) {
    try {
      if (!req.user || !req.user.userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }
      return await this.subscriptionService.cancelSubscription({
        user_id: req.user.userId,
        cancel_immediately: body.cancel_immediately,
        kind: body.kind,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to cancel subscription',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}