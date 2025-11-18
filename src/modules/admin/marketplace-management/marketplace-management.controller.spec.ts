import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketplaceManagementController } from './marketplace-management.controller';
import { MarketplaceManagementService } from './marketplace-management.service';

describe('MarketplaceManagementController', () => {
  let controller: MarketplaceManagementController;
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
      controllers: [MarketplaceManagementController],
      providers: [
        MarketplaceManagementService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    controller = module.get<MarketplaceManagementController>(MarketplaceManagementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
