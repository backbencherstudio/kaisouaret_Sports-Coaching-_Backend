import { Module } from '@nestjs/common';
import { FaqModule } from './faq/faq.module';
import { ContactModule } from './contact/contact.module';
import { WebsiteInfoModule } from './website-info/website-info.module';
import { PaymentTransactionModule } from './payment-transaction/payment-transaction.module';
import { UserModule } from './user/user.module';
import { NotificationModule } from './notification/notification.module';
import { Admin_dashboardModule } from './admin_dashboard/users/users.module';
import { UserListModule } from './user-management/user-list/user-list.module';
import { SubscriptionPlansController } from './subscription-plans/subscription-plans.controller';
import { StripeModule } from '../payment/stripe/stripe.module';
import { BookingListModule } from './booking_management/booking_list/booking_list.module';
import { ContentModule } from './content-management/content/content.module';
import { MarketplaceManagementModule } from './marketplace-management/marketplace-management.module';

@Module({
  imports: [
    FaqModule,
    ContactModule,
    WebsiteInfoModule,
    PaymentTransactionModule,
    UserModule,
    NotificationModule,
    Admin_dashboardModule,
    UserListModule,
    StripeModule,
    BookingListModule,
    BookingListModule,
    ContentModule,
    MarketplaceManagementModule
  ],
  controllers: [SubscriptionPlansController],
})
export class AdminModule {}
