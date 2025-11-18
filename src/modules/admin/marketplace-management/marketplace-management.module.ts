import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketplaceManagementService } from './marketplace-management.service';
import { MarketplaceManagementController } from './marketplace-management.controller';

@Module({
  controllers: [MarketplaceManagementController],
  providers: [MarketplaceManagementService, PrismaService],
})
export class MarketplaceManagementModule {}
