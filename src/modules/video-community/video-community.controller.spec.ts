import { Test, TestingModule } from '@nestjs/testing';
import { VideoCommunityController } from './video-community.controller';
import { VideoCommunityService } from './video-community.service';

describe('VideoCommunityController', () => {
  let controller: VideoCommunityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoCommunityController],
      providers: [VideoCommunityService],
    }).compile();

    controller = module.get<VideoCommunityController>(VideoCommunityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
