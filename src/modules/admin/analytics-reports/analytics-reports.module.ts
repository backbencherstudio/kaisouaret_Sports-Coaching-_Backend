import { Module } from '@nestjs/common';
import { AnalyticsReportsService } from './analytics-reports.service';
import { AnalyticsReportsController } from './analytics-reports.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [AnalyticsReportsController],
  providers: [AnalyticsReportsService, PrismaService],
})
export class AnalyticsReportsModule {}
