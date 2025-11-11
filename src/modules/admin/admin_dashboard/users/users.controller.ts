import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guard/role/roles.guard';
import { Roles } from '../../../../common/guard/role/roles.decorator';
import { Role } from '../../../../common/guard/role/role.enum';


@ApiBearerAuth()
@ApiTags('User')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  @Get('overview')
  async overview(){
    const response = await this.usersService.overview();
    return response;
  }
  @Get('revenue-trend')
async getRevenueTrend(
  @Query('months') months?: string,
  @Query('year') year?: string,
) {
  const monthsNum = months ? parseInt(months, 10) : undefined;
  const yearNum = year ? parseInt(year, 10) : undefined;

  return this.usersService.getRevenueTrend({
    months: Number.isFinite(monthsNum) ? monthsNum : undefined,
    year: Number.isFinite(yearNum) ? yearNum : undefined,
  });
}

  @Get('user-distribution')
  async getUserDistribution() {
    return this.usersService.getUserDistribution();
  }

  @Get('recent-activity')
async getRecentActivity(@Query('limit') limit?: string) {
  const lim = limit ? parseInt(limit, 10) : 10;
  return this.usersService.getRecentActivity(Number.isFinite(lim) ? lim : 10);
}
}
