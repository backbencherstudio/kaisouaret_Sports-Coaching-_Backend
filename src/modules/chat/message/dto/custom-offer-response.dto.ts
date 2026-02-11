import { IsNotEmpty, IsString } from 'class-validator';

export class CustomOfferResponseDto {
  @IsNotEmpty()
  @IsString()
  booking_id: string;

  @IsNotEmpty()
  @IsString()
  conversation_id: string;
}
