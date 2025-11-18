import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from '../subscription.service';

@Module({
  controllers: [StripeController, SubscriptionController],
  providers: [StripeService, SubscriptionService],
  exports: [SubscriptionService],
})
export class StripeModule {}
