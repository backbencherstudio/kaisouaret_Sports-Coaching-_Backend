import { Module } from '@nestjs/common';
import { VideoCommunityService } from './video-community.service';
import { VideoCommunityController } from './video-community.controller';

@Module({
  controllers: [VideoCommunityController],
  providers: [VideoCommunityService],
})
export class VideoCommunityModule {}
