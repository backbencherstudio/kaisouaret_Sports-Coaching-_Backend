import { Module } from '@nestjs/common';
import { BookingListService } from './booking_list.service';
import { BookingListController } from './booking_list.controller';

@Module({
  controllers: [BookingListController],
  providers: [BookingListService],
})
export class BookingListModule {}
