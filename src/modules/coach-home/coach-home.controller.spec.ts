import { Test, TestingModule } from '@nestjs/testing';
import { CoachHomeController } from './coach-home.controller';
import { CoachHomeService } from './coach-home.service';

describe('CoachHomeController', () => {
  let controller: CoachHomeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoachHomeController],
      providers: [CoachHomeService],
    }).compile();

    controller = module.get<CoachHomeController>(CoachHomeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
