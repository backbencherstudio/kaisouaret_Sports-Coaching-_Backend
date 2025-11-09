import { Controller, Post, Req, Headers } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { Request } from 'express';
import { TransactionRepository } from '../../../common/repository/transaction/transaction.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import * as crypto from 'crypto';

@Controller('payment/stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService, private readonly prisma: PrismaService) {}

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
        case 'customer.created':
          break;
        case 'payment_intent.created':
          break;
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object;
          // create tax transaction
          // await StripePayment.createTaxTransaction(
          //   paymentIntent.metadata['tax_calculation'],
          // );
          // Update transaction status in database
          await TransactionRepository.updateTransaction({
            reference_number: paymentIntent.id,
            status: 'succeeded',
            paid_amount: paymentIntent.amount / 100, // amount in dollars
            paid_currency: paymentIntent.currency,
            raw_status: paymentIntent.status,
          });

          // mark coach profile as paid/verified only if the transaction type indicates registration was included
          try {
            const tx = await this.prisma.paymentTransaction.findFirst({ where: { reference_number: paymentIntent.id } });
            if (tx && tx.user_id) {
                // Only mark registration fee when transaction type includes registration
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

                // If this transaction includes subscription (either registration+subscription or subscription-only)
                if (tx.type && (tx.type === 'subscription' || tx.type === 'registration_and_subscription')) {
                  try {
                    // fetch existing coach profile to compute expiry
                    const cp = await (this.prisma as any).coachProfile.findFirst({ where: { user_id: tx.user_id } });
                    const now = new Date();
                    let newStart = now;
                    let newExpires = new Date(now);
                    // add one month
                    if (cp && cp.subscription_expires_at && new Date(cp.subscription_expires_at) > now) {
                      // extend from existing expiry
                      newExpires = new Date(cp.subscription_expires_at);
                      newExpires.setMonth(newExpires.getMonth() + 1);
                      // keep existing start if present
                      newStart = cp.subscription_started_at ? new Date(cp.subscription_started_at) : now;
                    } else {
                      // start now and set expiry one month from now
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
                // If this transaction is related to a booking, mark booking as confirmed and generate validation token
                try {
                  const booking = await this.prisma.booking.findFirst({ where: { payment_transaction_id: tx.id } });
                  if (booking) {
                    // generate a secure 6-digit numeric token
                    const token = crypto.randomInt(100000, 1000000).toString();
                    const expires = new Date();
                    expires.setHours(expires.getHours() + 24); // token valid for 24 hours

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
          const failedPaymentIntent = event.data.object;
          // Update transaction status in database
          await TransactionRepository.updateTransaction({
            reference_number: failedPaymentIntent.id,
            status: 'failed',
            raw_status: failedPaymentIntent.status,
          });
        case 'payment_intent.canceled':
          const canceledPaymentIntent = event.data.object;
          // Update transaction status in database
          await TransactionRepository.updateTransaction({
            reference_number: canceledPaymentIntent.id,
            status: 'canceled',
            raw_status: canceledPaymentIntent.status,
          });
          break;
        case 'payment_intent.requires_action':
          const requireActionPaymentIntent = event.data.object;
          // Update transaction status in database
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
