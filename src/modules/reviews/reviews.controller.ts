import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @ApiOperation({ summary: 'Create a review for a booking (athlete only)' })
  @UseGuards(JwtAuthGuard)
  @Post('booking/:bookingId')
  async createReview(
    @GetUser('userId') athleteId: string,
    @Param('bookingId') bookingId: string,
    @Body() reviewDto: any,
  ) {
    return this.reviewsService.createReview(athleteId, bookingId, reviewDto);
  }

  @ApiOperation({ summary: 'Get reviews for a coach profile (paginated, public)' })
  @Get('coach/:coachId')
  async getCoachReviews(
    @Param('coachId') coachId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
  ) {
    return this.reviewsService.getCoachReviews(coachId, { page, limit });
  }
}
