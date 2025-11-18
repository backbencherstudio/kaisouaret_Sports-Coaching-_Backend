import { Test, TestingModule } from '@nestjs/testing';
import { BookingListService } from './booking_list.service';

describe('BookingListService', () => {
  let service: BookingListService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BookingListService],
    }).compile();

    service = module.get<BookingListService>(BookingListService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
