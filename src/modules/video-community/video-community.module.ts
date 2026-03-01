import { Module } from '@nestjs/common';
import { VideoCommunityService } from './video-community.service';
import { VideoCommunityController } from './video-community.controller';
import { AthleteVideoGuard } from './guards/athlete-video.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [VideoCommunityController],
  providers: [VideoCommunityService, AthleteVideoGuard],
})
export class VideoCommunityModule {}
