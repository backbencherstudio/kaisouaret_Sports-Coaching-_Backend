import { Module } from '@nestjs/common';
import { CoachHomeService } from './coach-home.service';
import { CoachHomeController } from './coach-home.controller';

@Module({
  controllers: [CoachHomeController],
  providers: [CoachHomeService],
})
export class CoachHomeModule {}
