import { Test, TestingModule } from '@nestjs/testing';
import { BadgeManagementController } from './badge-management.controller';
import { BadgeManagementService } from './badge-management.service';

describe('BadgeManagementController', () => {
  let controller: BadgeManagementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BadgeManagementController],
      providers: [BadgeManagementService],
    }).compile();

    controller = module.get<BadgeManagementController>(BadgeManagementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
