import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { BadgesService } from './badges.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@ApiTags('badges')
@Controller('badges')
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @ApiOperation({ summary: 'Get all badges (public). If authenticated the response includes earned flags.' })
  @Get()
  async getAll(@GetUser('userId') userId?: string) {
    return this.badgesService.getAllBadges(userId);
  }

  @ApiOperation({ summary: "Get the authenticated user's badges and summary" })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMine(@GetUser('userId') userId: string) {
    return this.badgesService.getMyBadges(userId);
  }

  @ApiOperation({ summary: 'Attempt to claim a badge for the authenticated user by badge key' })
  @UseGuards(JwtAuthGuard)
  @Post(':key/claim')
  async claim(@GetUser('userId') userId: string, @Param('key') key: string) {
    return this.badgesService.claimBadge(userId, key);
  }
}
