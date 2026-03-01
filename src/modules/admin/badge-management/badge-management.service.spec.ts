import { Test, TestingModule } from '@nestjs/testing';
import { BadgeManagementService } from './badge-management.service';

describe('BadgeManagementService', () => {
  let service: BadgeManagementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BadgeManagementService],
    }).compile();

    service = module.get<BadgeManagementService>(BadgeManagementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
