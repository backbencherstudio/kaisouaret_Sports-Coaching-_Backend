import { IsNotEmpty, IsString } from 'class-validator';
import { UpdateBookingDto } from '../../../bookings/dto/update-booking.dto';

export class BookingUpdateViaChatDto extends UpdateBookingDto {
  @IsNotEmpty()
  @IsString()
  booking_id: string;

  @IsNotEmpty()
  @IsString()
  conversation_id: string;
}
