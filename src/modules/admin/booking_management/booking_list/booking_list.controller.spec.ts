import { Test, TestingModule } from '@nestjs/testing';
import { BookingListController } from './booking_list.controller';
import { BookingListService } from './booking_list.service';

describe('BookingListController', () => {
  let controller: BookingListController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingListController],
      providers: [BookingListService],
    }).compile();

    controller = module.get<BookingListController>(BookingListController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
