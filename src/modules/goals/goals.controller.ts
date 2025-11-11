import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Put,
  Query,
  Patch,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { ProgressDto } from './dto/progress.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '../auth/decorators/get-user.decorator';

@ApiTags('goals')
@Controller('goals')
@UseGuards(JwtAuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @ApiOperation({ summary: 'Create a new goal for the authenticated user' })
  @Post('setup')
  async createGoal(
    @GetUser('userId') userId: string,
    @Body() body: CreateGoalDto,
  ) {
    // console.log('user id', userId);
    return this.goalsService.createGoal(userId, body);
  }

  @ApiOperation({
    summary: 'Update an existing goal for the authenticated user',
  })
  @Patch(':goalsId')
  async updateGoal(
    @GetUser('userId') userId: string,
    @Param('goalsId') goalsId: string,
    @Body() body: UpdateGoalDto,
  ) {
    return this.goalsService.updateGoal(userId, goalsId, body);
  }

  @ApiOperation({ summary: 'Get goals for the authenticated user' })
  @Get('me')
  async myGoals(@GetUser('userId') userId: string) {
    return this.goalsService.getMyGoals(userId);
  }

  @ApiOperation({ summary: 'Get a specific goal for the authenticated user' })
  @Get(':id')
  async getGoal(@Param('id') id: string, @GetUser('userId') userId: string) {
    return this.goalsService.getGoal(id, userId);
  }

  @ApiOperation({
    summary: 'Add progress to a specific goal for the authenticated user',
  })
  @Post(':id/progress')
  async addProgress(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() body: ProgressDto,
  ) {
    return this.goalsService.addProgress(userId, id, body);
  }

  @ApiOperation({ summary: 'List progress entries for a specific goal' })
  @Get(':id/progress')
  async listProgress(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.goalsService.listProgress(id, Number(page), Number(limit));
  }

  @ApiOperation({ summary: 'Add a coach note to a specific goal' })
  @Post(':id/coach-note')
  async addCoachNote(
    @Req() req: any,
    @Param('id') id: string,
    @Body('note') note: string,
  ) {
    // coachId is the authenticated user (coach)
    return this.goalsService.addCoachNote(
      req.user.id /* userId */,
      req.user.id /* coachId - TODO: adjust if coach editing others */,
      id,
      note,
    );
  }
}
