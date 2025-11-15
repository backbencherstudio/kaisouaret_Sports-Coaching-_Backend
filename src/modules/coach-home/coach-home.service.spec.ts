import { Test, TestingModule } from '@nestjs/testing';
import { CoachHomeService } from './coach-home.service';

describe('CoachHomeService', () => {
  let service: CoachHomeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CoachHomeService],
    }).compile();

    service = module.get<CoachHomeService>(CoachHomeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
