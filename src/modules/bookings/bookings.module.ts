import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { BookingsCleanupCron, BookingsPaymentExpiryCron } from '../../cron';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsCleanupCron, BookingsPaymentExpiryCron],
  exports: [BookingsService],
})
export class BookingsModule {}
