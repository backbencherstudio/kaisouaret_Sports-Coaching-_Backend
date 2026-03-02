import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsReportsService } from './analytics-reports.service';

describe('AnalyticsReportsService', () => {
  let service: AnalyticsReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsReportsService],
    }).compile();

    service = module.get<AnalyticsReportsService>(AnalyticsReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
