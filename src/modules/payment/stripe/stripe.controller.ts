import { Controller, Post, Req, Headers } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { Request } from 'express';
import { TransactionRepository } from '../../../common/repository/transaction/transaction.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';
import * as crypto from 'crypto';
import stripe from 'stripe';
import {
  NotificationsService,
  NotificationType,
} from '../../notifications/notifications.service';

@Controller('payment/stripe')
export class StripeController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: Request,
  ) {
    try {
      const addInterval = (start: Date, interval: string, count = 1) => {
        const safeCount = Number(count || 1);
        const result = new Date(start.valueOf());
        if (interval === 'year') {
          result.setFullYear(result.getFullYear() + safeCount);
        } else if (interval === 'month') {
          result.setMonth(result.getMonth() + safeCount);
        } else if (interval === 'day') {
          result.setDate(result.getDate() + safeCount);
        }
        return result;
      };

      const payload = req.rawBody.toString();
      const event = await this.stripeService.handleWebhook(payload, signature);

      console.log('[StripeWebhook] event.type:', event.type);

      // Handle events
      switch (event.type) {
        //====================================
        case 'checkout.session.completed':
          const session = event.data.object as stripe.Checkout.Session;
          console.log('[StripeWebhook] checkout.session.completed', {
            session_id: session.id,
            mode: session.mode,
            subscription: session.subscription,
            metadata: session.metadata,
          });
          if (session.mode === 'subscription') {
            const planId = session.metadata?.plan_id;
            const plan = planId
              ? await this.prisma.subscriptionPlan.findUnique({
                  where: { id: planId },
                  select: { kind: true },
                })
              : null;

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

            let normalizedPeriodEnd = periodEnd;
            if (normalizedPeriodEnd <= periodStart) {
              if (planId) {
                const planInterval =
                  await this.prisma.subscriptionPlan.findUnique({
                    where: { id: planId },
                    select: { interval: true },
                  });
                if (planInterval?.interval) {
                  normalizedPeriodEnd = addInterval(
                    periodStart,
                    planInterval.interval,
                    1,
                  );
                }
              }
            }

            console.log('[StripeWebhook] subscription.period', {
              subscription_id: subscription.id,
              status: subscription.status,
              current_period_start: periodStart,
              current_period_end: periodEnd,
              cancel_at_period_end: subscription.cancel_at_period_end,
            });

            await this.prisma.userSubscription.create({
              data: {
                user_id: session.metadata?.user_id || '',
                plan_id: session.metadata?.plan_id || '',
                stripe_subscription_id: subscription.id,
                status: subscription.status,
                current_period_start: periodStart,
                current_period_end: normalizedPeriodEnd,
                cancel_at_period_end:
                  subscription.cancel_at_period_end || false,
              },
            });
            console.log('[StripeWebhook] userSubscription created', {
              user_id: session.metadata?.user_id,
              plan_id: session.metadata?.plan_id,
              stripe_subscription_id: subscription.id,
              current_period_end: normalizedPeriodEnd,
            });

            // Send subscription started notification
            if (session.metadata?.user_id && session.metadata?.plan_id) {
              try {
                const user = await this.prisma.user.findUnique({
                  where: { id: session.metadata.user_id },
                  select: { name: true },
                });
                const plan = await this.prisma.subscriptionPlan.findUnique({
                  where: { id: session.metadata.plan_id },
                  select: { name: true },
                });

                if (user && plan) {
                  await this.notificationsService.sendNotification({
                    type: NotificationType.SUBSCRIPTION_STARTED,
                    recipient_id: session.metadata.user_id,
                    entity_id: session.metadata.plan_id,
                    variables: {
                      user_name: user.name,
                      plan_name: plan.name,
                      expiry_date: normalizedPeriodEnd
                        .toISOString()
                        .split('T')[0],
                    },
                  });
                }
              } catch (error) {
                console.error(
                  'Failed to send subscription started notification:',
                  error,
                );
              }
            }
            if (session.metadata?.user_id && plan?.kind === 'COACH') {
              await this.prisma.coachProfile.updateMany({
                where: { user_id: session.metadata.user_id },
                data: {
                  subscription_active: 1,
                  subscription_started_at: periodStart,
                  subscription_expires_at: normalizedPeriodEnd,
                  subscription_provider: 'stripe',
                  subscription_reference: subscription.id,
                },
              });

              console.log(
                '[StripeWebhook] coachProfile updated (subscription active)',
                {
                  user_id: session.metadata.user_id,
                  subscription_reference: subscription.id,
                  subscription_expires_at: normalizedPeriodEnd,
                },
              );

              if (session.metadata?.registration_fee === '1') {
                await this.prisma.coachProfile.updateMany({
                  where: { user_id: session.metadata.user_id },
                  data: {
                    registration_fee_paid: 1,
                    registration_fee_paid_at: new Date(),
                  },
                });
                console.log(
                  '[StripeWebhook] coachProfile updated (registration fee paid)',
                  {
                    user_id: session.metadata.user_id,
                  },
                );
              }
            }
          }
          break;

        case 'customer.subscription.updated':
          const updatedSubscription = event.data.object as any;
          console.log('[StripeWebhook] customer.subscription.updated', {
            subscription_id: updatedSubscription.id,
            status: updatedSubscription.status,
            cancel_at_period_end: updatedSubscription.cancel_at_period_end,
          });
          const updatedPeriodStart = updatedSubscription.current_period_start
            ? new Date(updatedSubscription.current_period_start * 1000)
            : new Date();
          const updatedPeriodEnd = updatedSubscription.current_period_end
            ? new Date(updatedSubscription.current_period_end * 1000)
            : new Date();
          let normalizedUpdatedEnd = updatedPeriodEnd;
          if (normalizedUpdatedEnd <= updatedPeriodStart) {
            const recurring =
              updatedSubscription.items?.data?.[0]?.price?.recurring;
            const interval = recurring?.interval;
            const intervalCount = Number(recurring?.interval_count || 1);
            if (interval) {
              normalizedUpdatedEnd = addInterval(
                updatedPeriodStart,
                interval,
                intervalCount,
              );
            }
          }

          await this.prisma.userSubscription.updateMany({
            where: { stripe_subscription_id: updatedSubscription.id },
            data: {
              status: updatedSubscription.status,
              current_period_start: updatedPeriodStart,
              current_period_end: normalizedUpdatedEnd,
              cancel_at_period_end:
                updatedSubscription.cancel_at_period_end || false,
            },
          });
          const userSub = await this.prisma.userSubscription.findFirst({
            where: { stripe_subscription_id: updatedSubscription.id },
          });
          console.log('[StripeWebhook] userSubscription found', {
            exists: !!userSub,
            user_id: userSub?.user_id,
          });

          if (userSub && updatedSubscription.status === 'active') {
            const expiresAt = normalizedUpdatedEnd;
            await this.prisma.coachProfile.updateMany({
              where: { user_id: userSub.user_id },
              data: {
                subscription_active: 1,
                subscription_expires_at: expiresAt,
              },
            });
            console.log(
              '[StripeWebhook] coachProfile updated (subscription active)',
              {
                user_id: userSub.user_id,
                subscription_expires_at: expiresAt,
              },
            );
          } else if (
            userSub &&
            ['canceled', 'unpaid', 'past_due'].includes(
              updatedSubscription.status,
            )
          ) {
            await this.prisma.coachProfile.updateMany({
              where: { user_id: userSub.user_id },
              data: {
                subscription_active: 0,
              },
            });
            console.log(
              '[StripeWebhook] coachProfile updated (subscription inactive)',
              {
                user_id: userSub.user_id,
              },
            );
          }
          break;

        case 'customer.subscription.deleted':
          const deletedSubscription = event.data.object as stripe.Subscription;
          console.log('[StripeWebhook] customer.subscription.deleted', {
            subscription_id: deletedSubscription.id,
          });
          await this.prisma.userSubscription.updateMany({
            where: { stripe_subscription_id: deletedSubscription.id },
            data: {
              status: 'canceled',
              deleted_at: new Date(),
            },
          });

          const deletedUserSub = await this.prisma.userSubscription.findFirst({
            where: { stripe_subscription_id: deletedSubscription.id },
            include: { plan: true },
          });

          if (deletedUserSub && deletedUserSub.plan?.kind === 'COACH') {
            await this.prisma.coachProfile.updateMany({
              where: { user_id: deletedUserSub.user_id },
              data: {
                subscription_active: 0,
              },
            });
            console.log(
              '[StripeWebhook] coachProfile updated (subscription deleted)',
              {
                user_id: deletedUserSub.user_id,
              },
            );
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

        case 'payment_intent.amount_capturable_updated':
          const capturableIntent = event.data.object as stripe.PaymentIntent;
          try {
            const tx = await this.prisma.paymentTransaction.findFirst({
              where: { reference_number: capturableIntent.id },
            });

            if (tx?.type === 'booking') {
              const booking = await this.prisma.booking.findFirst({
                where: { payment_transaction_id: tx.id },
              });
              if (booking) {
                const token = crypto.randomInt(100000, 1000000).toString();
                const expires = new Date();
                expires.setMonth(expires.getMonth() + 1);

                await this.prisma.booking.update({
                  where: { id: booking.id },
                  data: {
                    status: 'CONFIRMED',
                    validation_token: token,
                    token_expires_at: expires,
                  },
                });
              }

              await this.prisma.paymentTransaction.update({
                where: { id: tx.id },
                data: {
                  status: 'authorized',
                  raw_status: capturableIntent.status,
                },
              });
            }

            if (tx?.type === 'custom_offer') {
              const customOffer = await this.prisma.customOffer.findFirst({
                where: { payment_transaction_id: tx.id },
              });

              if (customOffer) {
                // Link custom offer payment transaction to booking (don't overwrite payment_transaction_id)
                const booking = await this.prisma.booking.findUnique({
                  where: { id: customOffer.booking_id },
                  select: { id: true, status: true, validation_token: true },
                });

                if (booking && booking.status === 'CONFIRMED') {
                  // Booking already has validation token, just update custom offer status
                  await this.prisma.customOffer.update({
                    where: { id: customOffer.id },
                    data: {
                      status: 'ACCEPTED',
                    },
                  });

                  // Link custom offer payment to booking
                  await this.prisma.booking.update({
                    where: { id: customOffer.booking_id },
                    data: {
                      custom_offer_payment_transaction_id: tx.id,
                    },
                  });
                } else {
                  // Generate validation token for custom offer
                  const token = crypto.randomInt(100000, 1000000).toString();
                  const expires = new Date();
                  expires.setMonth(expires.getMonth() + 1);

                  await this.prisma.customOffer.update({
                    where: { id: customOffer.id },
                    data: {
                      status: 'ACCEPTED',
                    },
                  });

                  // Update booking with custom offer details and validation token
                  // Only update these fields from the custom offer, keep original payment_transaction_id
                  await this.prisma.booking.update({
                    where: { id: customOffer.booking_id },
                    data: {
                      title: customOffer.title,
                      appointment_date: customOffer.appointment_date,
                      session_time: customOffer.session_time,
                      session_time_display: customOffer.session_time_display,
                      duration_minutes: customOffer.duration_minutes,
                      number_of_members: customOffer.number_of_members,
                      session_price: customOffer.session_price,
                      total_amount: customOffer.total_amount,
                      currency: customOffer.currency,
                      status: 'CONFIRMED',
                      validation_token: token,
                      token_expires_at: expires,
                      custom_offer_payment_transaction_id: tx.id,
                    },
                  });
                }
              }

              await this.prisma.paymentTransaction.update({
                where: { id: tx.id },
                data: {
                  status: 'authorized',
                  raw_status: capturableIntent.status,
                },
              });
            }
          } catch (err) {
            console.error('Failed to handle capturable payment intent:', err);
          }
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
            const tx = await this.prisma.paymentTransaction.findFirst({
              where: { reference_number: paymentIntent.id },
            });
            if (tx && tx.user_id) {
              if (tx.type === 'booking') {
                await this.prisma.paymentTransaction.update({
                  where: { id: tx.id },
                  data: {
                    status: 'captured',
                    paid_amount: paymentIntent.amount / 100,
                    paid_currency: paymentIntent.currency,
                    raw_status: paymentIntent.status,
                  },
                });
              }
              if (
                tx.type &&
                (tx.type === 'registration' ||
                  tx.type === 'registration_and_subscription')
              ) {
                await (this.prisma as any).coachProfile.updateMany({
                  where: { user_id: tx.user_id },
                  data: {
                    is_verified: 1,
                    registration_fee_paid: 1,
                    registration_fee_paid_at: new Date(),
                  },
                });
              }
              if (
                tx.type &&
                (tx.type === 'subscription' ||
                  tx.type === 'registration_and_subscription')
              ) {
                try {
                  const cp = await (this.prisma as any).coachProfile.findFirst({
                    where: { user_id: tx.user_id },
                  });
                  const now = new Date();
                  let newStart = now;
                  let newExpires = new Date(now);
                  if (
                    cp &&
                    cp.subscription_expires_at &&
                    new Date(cp.subscription_expires_at) > now
                  ) {
                    newExpires = new Date(cp.subscription_expires_at);
                    newExpires.setMonth(newExpires.getMonth() + 1);
                    newStart = cp.subscription_started_at
                      ? new Date(cp.subscription_started_at)
                      : now;
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
                  console.error(
                    'Failed to update subscription fields for coach profile:',
                    err,
                  );
                }
              }

              if (tx.type === 'custom_offer') {
                try {
                  const customOffer = await this.prisma.customOffer.findFirst({
                    where: { payment_transaction_id: tx.id },
                  });
                  if (customOffer) {
                    const paidAmount = paymentIntent.amount / 100;
                    const currentPaid = customOffer.paid_amount
                      ? Number(customOffer.paid_amount)
                      : 0;
                    await this.prisma.customOffer.update({
                      where: { id: customOffer.id },
                      data: {
                        status: 'ACCEPTED',
                        due_amount: 0,
                        paid_amount: currentPaid + paidAmount,
                        responded_at: new Date(),
                      },
                    });

                    await this.prisma.booking.update({
                      where: { id: customOffer.booking_id },
                      data: {
                        title: customOffer.title,
                        appointment_date: customOffer.appointment_date,
                        session_time: customOffer.session_time,
                        session_time_display: customOffer.session_time_display,
                        duration_minutes: customOffer.duration_minutes,
                        number_of_members: customOffer.number_of_members,
                        session_price: customOffer.session_price,
                        total_amount: customOffer.total_amount,
                        currency: customOffer.currency,
                      },
                    });
                  }
                } catch (err) {
                  console.error(
                    'Failed to mark custom offer accepted after payment:',
                    err,
                  );
                }
              }

              // Handle marketplace order confirmation
              if (tx.type === 'marketplace') {
                try {
                  // Find order by payment_transaction_id
                  const order = await this.prisma.marketplaceOrder.findFirst({
                    where: { payment_transaction_id: tx.id },
                  });

                  if (order) {
                    console.log(
                      `Processing marketplace order confirmation for order: ${order.id}`,
                    );

                    // Import marketplace service
                    const { MarketplaceManagementService } = await import(
                      '../../admin/marketplace-management/marketplace-management.service'
                    );
                    const marketplaceService = new MarketplaceManagementService(
                      this.prisma,
                    );

                    // Confirm order (updates stock, changes status to CONFIRMED)
                    await marketplaceService.confirmOrderInternal(order.id);

                    console.log(
                      `Marketplace order ${order.id} confirmed successfully via webhook`,
                    );
                  } else {
                    console.warn(
                      `No marketplace order found for payment transaction: ${tx.id}`,
                    );
                  }
                } catch (err) {
                  console.error(
                    'Failed to confirm marketplace order after payment:',
                    err,
                  );
                }
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
          try {
            const tx = await this.prisma.paymentTransaction.findFirst({
              where: { reference_number: failedPaymentIntent.id },
            });
            if (tx?.type === 'booking') {
              const booking = await this.prisma.booking.findFirst({
                where: { payment_transaction_id: tx.id },
              });
              if (booking) {
                await this.prisma.booking.update({
                  where: { id: booking.id },
                  data: {
                    status: 'CANCELLED',
                    validation_token: null,
                    token_expires_at: null,
                  },
                });
              }
            }
          } catch (err) {
            console.error('Failed to handle booking payment failure:', err);
          }
          break;
        case 'payment_intent.canceled':
          const canceledPaymentIntent = event.data
            .object as stripe.PaymentIntent;
          await TransactionRepository.updateTransaction({
            reference_number: canceledPaymentIntent.id,
            status: 'canceled',
            raw_status: canceledPaymentIntent.status,
          });
          try {
            const tx = await this.prisma.paymentTransaction.findFirst({
              where: { reference_number: canceledPaymentIntent.id },
            });
            if (tx?.type === 'booking') {
              const booking = await this.prisma.booking.findFirst({
                where: { payment_transaction_id: tx.id },
              });
              if (booking) {
                await this.prisma.booking.update({
                  where: { id: booking.id },
                  data: {
                    status: 'CANCELLED',
                    validation_token: null,
                    token_expires_at: null,
                  },
                });
              }
            }
          } catch (err) {
            console.error(
              'Failed to handle booking payment cancellation:',
              err,
            );
          }
          break;
        case 'payment_intent.requires_action':
          const requireActionPaymentIntent = event.data
            .object as stripe.PaymentIntent;
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
