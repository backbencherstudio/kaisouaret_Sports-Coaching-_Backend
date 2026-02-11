import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StripePayment } from '../common/lib/Payment/stripe/StripePayment';

@Injectable()
export class BookingsPaymentExpiryCron {
  private readonly logger = new Logger(BookingsPaymentExpiryCron.name);

  constructor(private readonly prisma: PrismaService) {}

  // Runs every hour to cancel expired booking holds
  @Cron(CronExpression.EVERY_HOUR)
  async cancelExpiredBookingHolds() {
    try {
      const now = new Date();
      const expiredBookings = await this.prisma.booking.findMany({
        where: {
          status: 'CONFIRMED',
          validation_token: { not: null },
          token_expires_at: { lt: now },
          payment_transaction_id: { not: null },
        },
        select: {
          id: true,
          payment_transaction_id: true,
        },
      });

      if (expiredBookings.length === 0) return;

      this.logger.log(
        `Found ${expiredBookings.length} expired booking payment(s) to cancel`,
      );

      for (const booking of expiredBookings) {
        try {
          const tx = await this.prisma.paymentTransaction.findUnique({
            where: { id: booking.payment_transaction_id as string },
          });

          if (!tx?.reference_number) continue;

          const intent = await StripePayment.retrievePaymentIntent(
            tx.reference_number,
          );

          if (intent.status === 'succeeded') {
            await StripePayment.createRefund(tx.reference_number);
            await this.prisma.paymentTransaction.update({
              where: { id: tx.id },
              data: {
                status: 'refunded',
                raw_status: intent.status,
              },
            });
          } else {
            await StripePayment.cancelPaymentIntent(tx.reference_number);
            await this.prisma.paymentTransaction.update({
              where: { id: tx.id },
              data: {
                status: 'canceled',
                raw_status: intent.status,
              },
            });
          }

          await this.prisma.booking.update({
            where: { id: booking.id },
            data: {
              status: 'CANCELLED',
              validation_token: null,
              token_expires_at: null,
            },
          });
        } catch (error) {
          this.logger.warn(
            `Failed to cancel expired booking ${booking.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to run booking payment expiry cron', error);
    }
  }
}
