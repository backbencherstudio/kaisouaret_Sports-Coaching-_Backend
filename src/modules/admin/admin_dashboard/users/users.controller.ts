import { Controller, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guard/role/roles.guard';
import { Roles } from '../../../../common/guard/role/roles.decorator';
import { Role } from '../../../../common/guard/role/role.enum';
import { RevenueTrendQueryDto } from './dto/revenue-trend-query.dto';
import {RecentActivityQueryDto} from './dto/recent-activity-query.dto'


@ApiBearerAuth()
@ApiTags('User')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }
  @Get('overview')
  async overview() {
    const response = await this.usersService.overview();
    return response;
  }
  @Get('revenue-trend')
  async getRevenueTrend(
    @Query() query: RevenueTrendQueryDto,
  ) {
    return this.usersService.getRevenueTrend({
      months: query.months,
      year: query.year,
    });
  }

  @Get('user-distribution')
  async getUserDistribution() {
    return this.usersService.getUserDistribution();
  }

  @Get('recent-activity')
  async getRecentActivity(
    @Query() query: RecentActivityQueryDto,
  ) {
    return this.usersService.getRecentActivity(query.limit);
  }
}
