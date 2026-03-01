import { Module } from '@nestjs/common';
import { BadgeManagementService } from './badge-management.service';
import { BadgeManagementController } from './badge-management.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [BadgeManagementController],
  providers: [BadgeManagementService, PrismaService],
})
export class BadgeManagementModule {}
