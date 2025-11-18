import { Test, TestingModule } from '@nestjs/testing';
import { VideoCommunityService } from './video-community.service';

describe('VideoCommunityService', () => {
  let service: VideoCommunityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoCommunityService],
    }).compile();

    service = module.get<VideoCommunityService>(VideoCommunityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
