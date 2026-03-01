import {
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripePayment } from '../../common/lib/Payment/stripe/StripePayment';
import appConfig from '../../config/app.config';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';

@Injectable()
export class SubscriptionService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}
  async createOrUpdatePlan({
    plan_id,
    name,
    price,
    currency = 'USD',
    interval = 'month',
    kind = 'COACH',
    features,
    description,
  }: {
    plan_id?: string;
    name: string;
    price: number;
    currency?: string;
    interval?: string;
    kind?: string;
    features?: string[];
    description?: string;
  }) {
    const normalizedKind = String(kind || 'COACH').toUpperCase();
    if (!['COACH', 'ATHLETE'].includes(normalizedKind)) {
      throw new HttpException('Invalid plan kind', HttpStatus.BAD_REQUEST);
    }
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
          kind: normalizedKind as any,
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
          kind: normalizedKind as any,
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
    enforce_coach = false,
    enforce_athlete = false,
  }: {
    user_id: string;
    plan_id: string;
    enforce_coach?: boolean;
    enforce_athlete?: boolean;
  }) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: user_id },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (enforce_coach && user.type !== 'coach') {
        throw new HttpException(
          'Only coaches can subscribe to coach plans',
          HttpStatus.FORBIDDEN,
        );
      }
      if (enforce_athlete && user.type === 'coach') {
        throw new HttpException(
          'Coaches cannot subscribe to athlete plans',
          HttpStatus.FORBIDDEN,
        );
      }

      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: plan_id },
      });

      if (!plan) {
        throw new NotFoundException('Subscription plan not found');
      }

      if (enforce_coach && plan.kind !== 'COACH') {
        throw new HttpException(
          'Only coach plans can be used for coach subscriptions',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (enforce_athlete && plan.kind !== 'ATHLETE') {
        throw new HttpException(
          'Only athlete plans can be used for athlete subscriptions',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (enforce_coach || enforce_athlete) {
        const existingSubscription =
          await this.prisma.userSubscription.findFirst({
            where: {
              user_id,
              status: 'active',
              deleted_at: null,
            },
            select: { id: true },
          });

        if (existingSubscription) {
          throw new HttpException(
            'Active subscription already exists for this user',
            HttpStatus.CONFLICT,
          );
        }
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

      let addInvoiceItems: Array<{
        amount: number;
        currency: string;
        description: string;
      }> = [];

      if (enforce_coach) {
        const coachProfile = await this.prisma.coachProfile.findFirst({
          where: { user_id },
          select: { registration_fee_paid: true },
        });

        if (!coachProfile || !coachProfile.registration_fee_paid) {
          const registrationFee =
            appConfig().payment.registration.coach_registration_fee ?? 10;
          addInvoiceItems.push({
            amount: registrationFee,
            currency: plan.currency || 'USD',
            description: 'Coach registration fee',
          });
        }
      }

      const session = await StripePayment.createSubscriptionCheckoutSession({
        customer_id,
        price_id: plan.stripe_price_id,
        success_url: `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/subscription/cancel`,
        metadata: {
          user_id,
          plan_id,
          registration_fee: addInvoiceItems.length > 0 ? '1' : '0',
        },
        add_invoice_items:
          addInvoiceItems.length > 0 ? addInvoiceItems : undefined,
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
    kind,
  }: {
    user_id: string;
    cancel_immediately?: boolean;
    kind?: string;
  }) {
    let normalizedKind: string | undefined;
    if (kind) {
      normalizedKind = String(kind).toUpperCase();
      if (!['COACH', 'ATHLETE'].includes(normalizedKind)) {
        throw new HttpException('Invalid plan kind', HttpStatus.BAD_REQUEST);
      }
    }
    const subscription = await this.prisma.userSubscription.findFirst({
      where: {
        user_id,
        status: 'active',
        ...(normalizedKind ? { plan: { kind: normalizedKind as any } } : {}),
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

  async getUserSubscription(user_id: string, kind?: string) {
    let normalizedKind: string | undefined;
    if (kind) {
      normalizedKind = String(kind).toUpperCase();
      if (!['COACH', 'ATHLETE'].includes(normalizedKind)) {
        throw new HttpException('Invalid plan kind', HttpStatus.BAD_REQUEST);
      }
    }
    const subscription = await this.prisma.userSubscription.findFirst({
      where: {
        user_id,
        status: 'active',
        ...(normalizedKind ? { plan: { kind: normalizedKind as any } } : {}),
      },
      include: {
        plan: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Active subscription not found');
    }

    return {
      data: subscription,
      hasSubscription: !!subscription,
    };
  }

  async getAllPlans(kind?: string) {
    let normalizedKind: string | undefined;
    if (kind) {
      normalizedKind = String(kind).toUpperCase();
      if (!['COACH', 'ATHLETE'].includes(normalizedKind)) {
        throw new HttpException('Invalid plan kind', HttpStatus.BAD_REQUEST);
      }
    }
    return await this.prisma.subscriptionPlan.findMany({
      where: {
        is_active: 1,
        deleted_at: null,
        ...(normalizedKind ? { kind: normalizedKind as any } : {}),
      },
      orderBy: {
        sort_order: 'asc',
      },
    });
  }
}
