import { Injectable, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripePayment } from '../../common/lib/Payment/stripe/StripePayment';
import appConfig from '../../config/app.config';

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}
  async createOrUpdatePlan({
    plan_id,
    name,
    price,
    currency = 'USD',
    interval = 'month',
    features,
    description,
  }: {
    plan_id?: string;
    name: string;
    price: number;
    currency?: string;
    interval?: string;
    features?: string[];
    description?: string;
  }) {
    const product = await StripePayment.createProduct({
      name,
      description,
    });
    const stripePrice = await StripePayment.createPrice({
      product_id: product.id,
      amount: price,
      currency: currency.toLowerCase(),
      interval: interval as 'month' | 'year',
    });
    if (plan_id) {
      return await this.prisma.subscriptionPlan.update({
        where: { id: plan_id },
        data: {
          name,
          price,
          currency,
          interval,
          features: features || [],
          description,
          stripe_price_id: stripePrice.id,
        },
      });
    } else {
      return await this.prisma.subscriptionPlan.create({
        data: {
          name,
          price,
          currency,
          interval,
          features: features || [],
          description,
          stripe_price_id: stripePrice.id,
        },
      });
    }
  }
  async createSubscriptionCheckout({
    user_id,
    plan_id,
  }: {
    user_id: string;
    plan_id: string;
  }) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: user_id },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: plan_id },
      });

      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }

      if (!plan.stripe_price_id) {
        throw new HttpException(
          'Plan is not synced with Stripe. Please contact administrator.',
          HttpStatus.BAD_REQUEST,
        );
      }
      let customer_id = user.billing_id;
      if (!customer_id) {
        const customer = await StripePayment.createCustomer({
          user_id: user.id,
          name: user.name || user.email || '',
          email: user.email || '',
        });
        customer_id = customer.id;
        
        await this.prisma.user.update({
          where: { id: user_id },
          data: { billing_id: customer_id },
        });
      }
      const baseUrl = appConfig().app.client_app_url || appConfig().app.url;
      const session = await StripePayment.createSubscriptionCheckoutSession({
        customer_id,
        price_id: plan.stripe_price_id,
        success_url: `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/subscription/cancel`,
        metadata: {
          user_id,
          plan_id,
        },
      });

      return session;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error.type && error.type.startsWith('Stripe')) {
        throw new HttpException(
          `Stripe error: ${error.message || 'Payment processing failed'}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        error.message || 'Failed to create checkout session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  async cancelSubscription({
    user_id,
    cancel_immediately = false,
  }: {
    user_id: string;
    cancel_immediately?: boolean;
  }) {
    const subscription = await this.prisma.userSubscription.findFirst({
      where: {
        user_id,
        status: 'active',
      },
    });

    if (!subscription || !subscription.stripe_subscription_id) {
      throw new NotFoundException('Active subscription not found');
    }

    const stripeSubscription = await StripePayment.cancelSubscription(
      subscription.stripe_subscription_id,
      !cancel_immediately,
    );
    return await this.prisma.userSubscription.update({
      where: { id: subscription.id },
      data: {
        status: stripeSubscription.status,
        cancel_at_period_end: stripeSubscription.cancel_at_period_end || false,
      },
    });
  }
  async getUserSubscription(user_id: string) {
    const subscription = await this.prisma.userSubscription.findFirst({
      where: {
        user_id,
        status: 'active',
      },
      include: {
        plan: true,
      },
    });
    return {
      data: subscription,
      hasSubscription: !!subscription,
    };
  }
  async getAllPlans() {
    return await this.prisma.subscriptionPlan.findMany({
      where: {
        is_active: 1,
        deleted_at: null,
      },
      orderBy: {
        sort_order: 'asc',
      },
    });
  }
}