import { Module } from '@nestjs/common';
import { NotificationModule } from './notification/notification.module';
import { ContactModule } from './contact/contact.module';
import { FaqModule } from './faq/faq.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationModule, ContactModule, FaqModule, NotificationsModule],
})
export class ApplicationModule {}
