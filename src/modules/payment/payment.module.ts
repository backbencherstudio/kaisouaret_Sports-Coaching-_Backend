import { Module } from '@nestjs/common';
import { StripeModule } from './stripe/stripe.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [StripeModule, NotificationsModule],
})
export class PaymentModule {}
