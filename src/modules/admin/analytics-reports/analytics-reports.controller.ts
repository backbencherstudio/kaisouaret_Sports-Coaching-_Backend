import { Controller, Get, Query, UseGuards, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { AnalyticsReportsService } from './analytics-reports.service';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guard/role/roles.guard';
import { Roles } from '../../../common/guard/role/roles.decorator';
import { Role } from '../../../common/guard/role/role.enum';
import { PDFGenerator } from './pdf-generator.helper';
import { Readable } from 'stream';

@ApiBearerAuth()
@ApiTags('Analytics & Reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/analytics-reports')
export class AnalyticsReportsController {
  constructor(
    private readonly analyticsReportsService: AnalyticsReportsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get overview statistics for dashboard cards' })
  async getOverview() {
    return this.analyticsReportsService.getOverview();
  }

  @Get('revenue-analytics')
  @ApiOperation({ summary: 'Get revenue analytics chart data' })
  @ApiQuery({ name: 'months', required: false, type: Number, example: 6 })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026 })
  async getRevenueAnalytics(
    @Query('months') months?: string,
    @Query('year') year?: string,
  ) {
    return this.analyticsReportsService.getRevenueAnalytics({
      months: months ? parseInt(months) : undefined,
      year: year ? parseInt(year) : undefined,
    });
  }

  @Get('session-types')
  @ApiOperation({ summary: 'Get session types breakdown' })
  async getSessionTypes() {
    return this.analyticsReportsService.getSessionTypes();
  }

  @Get('export/user-activity')
  @ApiOperation({ summary: 'Generate User Activity Report PDF' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['week', 'month', 'year'],
    example: 'month',
  })
  async exportUserActivity(
    @Query('period') period?: 'week' | 'month' | 'year',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const reportData = await this.analyticsReportsService.generateUserActivityReport(
      period || 'month',
    );

    const pdfDoc = PDFGenerator.generateUserActivityPDF(reportData);
    const chunks: Buffer[] = [];

    return new Promise<StreamableFile>((resolve, reject) => {
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        const stream = Readable.from(pdfBuffer);
        
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="user-activity-${period || 'month'}.pdf"`,
          'Content-Length': pdfBuffer.length,
        });

        resolve(new StreamableFile(stream));
      });
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }

  @Get('export/revenue')
  @ApiOperation({ summary: 'Generate Revenue Report PDF' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['week', 'month', 'year'],
    example: 'month',
  })
  async exportRevenue(
    @Query('period') period?: 'week' | 'month' | 'year',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const reportData = await this.analyticsReportsService.generateRevenueReport(
      period || 'month',
    );

    const pdfDoc = PDFGenerator.generateRevenuePDF(reportData);
    const chunks: Buffer[] = [];

    return new Promise<StreamableFile>((resolve, reject) => {
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        const stream = Readable.from(pdfBuffer);
        
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="revenue-report-${period || 'month'}.pdf"`,
          'Content-Length': pdfBuffer.length,
        });

        resolve(new StreamableFile(stream));
      });
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }

  @Get('export/session-statistics')
  @ApiOperation({ summary: 'Generate Session Statistics Report PDF' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['week', 'month', 'year'],
    example: 'month',
  })
  async exportSessionStatistics(
    @Query('period') period?: 'week' | 'month' | 'year',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const reportData = await this.analyticsReportsService.generateSessionStatistics(
      period || 'month',
    );

    const pdfDoc = PDFGenerator.generateSessionStatisticsPDF(reportData);
    const chunks: Buffer[] = [];

    return new Promise<StreamableFile>((resolve, reject) => {
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        const stream = Readable.from(pdfBuffer);
        
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="session-statistics-${period || 'month'}.pdf"`,
          'Content-Length': pdfBuffer.length,
        });

        resolve(new StreamableFile(stream));
      });
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }

  @Get('export/coach-performance')
  @ApiOperation({ summary: 'Generate Coach Performance Report PDF' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['week', 'month', 'year'],
    example: 'month',
  })
  async exportCoachPerformance(
    @Query('period') period?: 'week' | 'month' | 'year',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const reportData = await this.analyticsReportsService.generateCoachPerformanceReport(
      period || 'month',
    );

    const pdfDoc = PDFGenerator.generateCoachPerformancePDF(reportData);
    const chunks: Buffer[] = [];

    return new Promise<StreamableFile>((resolve, reject) => {
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        const stream = Readable.from(pdfBuffer);
        
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="coach-performance-${period || 'month'}.pdf"`,
          'Content-Length': pdfBuffer.length,
        });

        resolve(new StreamableFile(stream));
      });
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }

  @Get('export/analytics')
  @ApiOperation({ summary: 'Generate comprehensive Analytics Report PDF' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['week', 'month', 'year'],
    example: 'month',
  })
  async exportAnalytics(
    @Query('period') period?: 'week' | 'month' | 'year',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const reportData = await this.analyticsReportsService.generateAnalyticsReport(
      period || 'month',
    );

    const pdfDoc = PDFGenerator.generateAnalyticsPDF(reportData);
    const chunks: Buffer[] = [];

    return new Promise<StreamableFile>((resolve, reject) => {
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        const stream = Readable.from(pdfBuffer);
        
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="analytics-report-${period || 'month'}.pdf"`,
          'Content-Length': pdfBuffer.length,
        });

        resolve(new StreamableFile(stream));
      });
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }
}
