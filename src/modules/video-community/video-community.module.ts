import { Module } from '@nestjs/common';
import { VideoCommunityService } from './video-community.service';
import { VideoCommunityController } from './video-community.controller';
import { AthleteVideoGuard } from './guards/athlete-video.guard';

@Module({
  controllers: [VideoCommunityController],
  providers: [VideoCommunityService, AthleteVideoGuard],
})
export class VideoCommunityModule {}
