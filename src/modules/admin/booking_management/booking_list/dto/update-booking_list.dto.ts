import { PartialType } from '@nestjs/swagger';
import { CreateBookingListDto } from './create-booking_list.dto';

export class UpdateBookingListDto extends PartialType(CreateBookingListDto) {}
