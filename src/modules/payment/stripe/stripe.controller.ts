import { Controller, Post, Req, Headers } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { Request } from 'express';
import { TransactionRepository } from '../../../common/repository/transaction/transaction.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';
import * as crypto from 'crypto';
import stripe from 'stripe';

@Controller('payment/stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService, private readonly prisma: PrismaService) { }

  @Post('webhook')
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: Request,
  ) {
    try {
      const payload = req.rawBody.toString();
      const event = await this.stripeService.handleWebhook(payload, signature);

      // Handle events
      switch (event.type) {
        //====================================
        case 'checkout.session.completed':
          const session = event.data.object as stripe.Checkout.Session;
          if (session.mode === 'subscription') {
            const subscription = await StripePayment.getSubscription(
              session.subscription as string,
            );
            const sub = subscription as any;
            const periodStart = sub.current_period_start 
              ? new Date(sub.current_period_start * 1000)
              : new Date();
            const periodEnd = sub.current_period_end 
              ? new Date(sub.current_period_end * 1000)
              : new Date();

            await this.prisma.userSubscription.create({
              data: {
                user_id: session.metadata?.user_id || '',
                plan_id: session.metadata?.plan_id || '',
                stripe_subscription_id: subscription.id,
                status: subscription.status,
                current_period_start: periodStart,
                current_period_end: periodEnd,
                cancel_at_period_end: subscription.cancel_at_period_end || false,
              },
            });
            if (session.metadata?.user_id) {
              await this.prisma.coachProfile.updateMany({
                where: { user_id: session.metadata.user_id },
                data: {
                  subscription_active: 1,
                  subscription_started_at: periodStart,
                  subscription_expires_at: periodEnd,
                  subscription_provider: 'stripe',
                  subscription_reference: subscription.id,
                },
              });
            }
          }
          break;

        case 'customer.subscription.updated':
          const updatedSubscription = event.data.object as any;
          const updatedPeriodStart = updatedSubscription.current_period_start 
            ? new Date(updatedSubscription.current_period_start * 1000)
            : new Date();
          const updatedPeriodEnd = updatedSubscription.current_period_end 
            ? new Date(updatedSubscription.current_period_end * 1000)
            : new Date();

          await this.prisma.userSubscription.updateMany({
            where: { stripe_subscription_id: updatedSubscription.id },
            data: {
              status: updatedSubscription.status,
              current_period_start: updatedPeriodStart,
              current_period_end: updatedPeriodEnd,
              cancel_at_period_end: updatedSubscription.cancel_at_period_end || false,
            },
          });
          const userSub = await this.prisma.userSubscription.findFirst({
            where: { stripe_subscription_id: updatedSubscription.id },
          });

          if (userSub && updatedSubscription.status === 'active') {
            const expiresAt = updatedSubscription.current_period_end 
              ? new Date(updatedSubscription.current_period_end * 1000)
              : new Date();
            await this.prisma.coachProfile.updateMany({
              where: { user_id: userSub.user_id },
              data: {
                subscription_active: 1,
                subscription_expires_at: expiresAt,
              },
            });
          } else if (userSub && ['canceled', 'unpaid', 'past_due'].includes(updatedSubscription.status)) {
            await this.prisma.coachProfile.updateMany({
              where: { user_id: userSub.user_id },
              data: {
                subscription_active: 0,
              },
            });
          }
          break;

        case 'customer.subscription.deleted':
          const deletedSubscription = event.data.object as stripe.Subscription;
          await this.prisma.userSubscription.updateMany({
            where: { stripe_subscription_id: deletedSubscription.id },
            data: {
              status: 'canceled',
              deleted_at: new Date(),
            },
          });

          const deletedUserSub = await this.prisma.userSubscription.findFirst({
            where: { stripe_subscription_id: deletedSubscription.id },
          });

          if (deletedUserSub) {
            await this.prisma.coachProfile.updateMany({
              where: { user_id: deletedUserSub.user_id },
              data: {
                subscription_active: 0,
              },
            });
          }
          break;

        case 'invoice.payment_succeeded':
          const invoice = event.data.object as any;
          if (invoice.subscription) {
          }
          break;

        case 'invoice.payment_failed':
          const failedInvoice = event.data.object as any;
          if (failedInvoice.subscription) {
          }
          break;

        //===================================
        case 'customer.created':
          break;
        case 'payment_intent.created':
          break;

        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as stripe.PaymentIntent;
          await TransactionRepository.updateTransaction({
            reference_number: paymentIntent.id,
            status: 'succeeded',
            paid_amount: paymentIntent.amount / 100, 
            paid_currency: paymentIntent.currency,
            raw_status: paymentIntent.status,
          });
          try {
            const tx = await this.prisma.paymentTransaction.findFirst({ where: { reference_number: paymentIntent.id } });
            if (tx && tx.user_id) {
              if (tx.type && (tx.type === 'registration' || tx.type === 'registration_and_subscription')) {
                await (this.prisma as any).coachProfile.updateMany({
                  where: { user_id: tx.user_id },
                  data: {
                    is_verified: 1,
                    registration_fee_paid: 1,
                    registration_fee_paid_at: new Date(),
                  },
                });
              }
              if (tx.type && (tx.type === 'subscription' || tx.type === 'registration_and_subscription')) {
                try {
                  const cp = await (this.prisma as any).coachProfile.findFirst({ where: { user_id: tx.user_id } });
                  const now = new Date();
                  let newStart = now;
                  let newExpires = new Date(now);
                  if (cp && cp.subscription_expires_at && new Date(cp.subscription_expires_at) > now) {
                    newExpires = new Date(cp.subscription_expires_at);
                    newExpires.setMonth(newExpires.getMonth() + 1);
                    newStart = cp.subscription_started_at ? new Date(cp.subscription_started_at) : now;
                  } else {
                    newStart = now;
                    newExpires = new Date(now);
                    newExpires.setMonth(newExpires.getMonth() + 1);
                  }

                  await (this.prisma as any).coachProfile.updateMany({
                    where: { user_id: tx.user_id },
                    data: {
                      subscription_active: 1,
                      subscription_started_at: newStart,
                      subscription_expires_at: newExpires,
                      subscription_provider: 'stripe',
                      subscription_reference: paymentIntent.id,
                    },
                  });
                } catch (err) {
                  console.error('Failed to update subscription fields for coach profile:', err);
                }
              }
              try {
                const booking = await this.prisma.booking.findFirst({ where: { payment_transaction_id: tx.id } });
                if (booking) {
                  const token = crypto.randomInt(100000, 1000000).toString();
                  const expires = new Date();
                  expires.setHours(expires.getHours() + 24); 

                  await this.prisma.booking.update({
                    where: { id: booking.id },
                    data: {
                      status: 'CONFIRMED',
                      validation_token: token,
                      token_expires_at: expires,
                    },
                  });
                }
              } catch (err) {
                console.error('Failed to mark booking confirmed after payment:', err);
              }
            }
          } catch (err) {
            console.error('Failed to mark coach profile after payment:', err);
          }
          break;
        case 'payment_intent.payment_failed':
          const failedPaymentIntent = event.data.object as stripe.PaymentIntent;
          await TransactionRepository.updateTransaction({
            reference_number: failedPaymentIntent.id,
            status: 'failed',
            raw_status: failedPaymentIntent.status,
          });
        case 'payment_intent.canceled':
          const canceledPaymentIntent = event.data.object as stripe.PaymentIntent;
          await TransactionRepository.updateTransaction({
            reference_number: canceledPaymentIntent.id,
            status: 'canceled',
            raw_status: canceledPaymentIntent.status,
          });
          break;
        case 'payment_intent.requires_action':
          const requireActionPaymentIntent = event.data.object as stripe.PaymentIntent;
          await TransactionRepository.updateTransaction({
            reference_number: requireActionPaymentIntent.id,
            status: 'requires_action',
            raw_status: requireActionPaymentIntent.status,
          });
          break;
        case 'payout.paid':
          const paidPayout = event.data.object;
          console.log(paidPayout);
          break;
        case 'payout.failed':
          const failedPayout = event.data.object;
          console.log(failedPayout);
          break;
        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      console.error('Webhook error', error);
      return { received: false };
    }
  }
}
