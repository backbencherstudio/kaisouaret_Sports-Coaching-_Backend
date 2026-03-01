import { Module } from '@nestjs/common';
import { ConversationModule } from './conversation/conversation.module';
import { MessageModule } from './message/message.module';
import { UserModule } from './user/user.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ConversationModule, MessageModule, UserModule, NotificationsModule],
})
export class ChatModule {}
