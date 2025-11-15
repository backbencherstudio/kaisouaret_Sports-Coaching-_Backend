import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CoachHomeService } from './coach-home.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('coach-home')
@UseGuards(JwtAuthGuard)
@ApiTags('coach-home')
export class CoachHomeController {
  constructor(private readonly coachHomeService: CoachHomeService) {}

  @ApiOperation({ summary: 'Get overview metrics for the coach' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('overview')
  async overview(@GetUser('userId') coachId: string) {
    console.log('coach id', coachId);
    return this.coachHomeService.getOverview(coachId);
  }

  @ApiOperation({ summary: 'Get weekly sessions counts for the last 7 days' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('weekly-sessions')
  async weekly(@GetUser('userId') coachId: string) {
    return this.coachHomeService.getWeeklySessions(coachId);
  }

  @ApiOperation({
    summary: 'Get top recurring customers by completed bookings',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('top-customers')
  async topCustomers(
    @GetUser('userId') coachId: string,
    @Query('limit') limit?: string,
  ) {
    const l = limit ? Number(limit) : undefined;
    return this.coachHomeService.getTopCustomers(coachId, l);
  }

  @ApiOperation({
    summary: 'Get performance metrics for the coach',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('performance')
  async performance(@GetUser('userId') coachId: string) {
    return this.coachHomeService.getPerformance(coachId);
  }
}
