import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketplaceManagementService } from './marketplace-management.service';

describe('MarketplaceManagementService', () => {
  let service: MarketplaceManagementService;
  const prismaMock = {
    marketplaceProduct: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceManagementService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<MarketplaceManagementService>(MarketplaceManagementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
