import { Module } from '@nestjs/common';
import { CoachHomeService } from './coach-home.service';
import { CoachHomeController } from './coach-home.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [CoachHomeController],
  providers: [CoachHomeService],
})
export class CoachHomeModule {}
