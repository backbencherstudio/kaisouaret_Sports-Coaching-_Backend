import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from '../subscription.service';
import { ConnectController } from './connect.controller';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [StripeController, SubscriptionController, ConnectController],
  providers: [StripeService, SubscriptionService],
  exports: [SubscriptionService],
})
export class StripeModule {}
