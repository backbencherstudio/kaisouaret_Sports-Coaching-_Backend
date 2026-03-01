import { Global, Module } from '@nestjs/common';
import { BookingsModule } from '../../bookings/bookings.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { MessageGateway } from './message.gateway';

@Global()
@Module({
  imports: [BookingsModule, NotificationsModule],
  controllers: [MessageController],
  providers: [MessageService, MessageGateway],
  exports: [MessageGateway],
})
export class MessageModule {}
