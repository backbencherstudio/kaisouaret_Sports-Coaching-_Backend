import {
  Body,
  Controller,
  Post,
  UseGuards,
  Get,
  Query,
  Param,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { VideoCommunityService } from './video-community.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AthleteVideoGuard } from './guards/athlete-video.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CreatePostDto } from './dto/video-community-create.dto';
import { memoryStorage } from 'multer';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { hasSubscribers, subscribe } from 'diagnostics_channel';

@Controller('video-community')
@ApiTags('video-community')
@UseGuards(JwtAuthGuard, AthleteVideoGuard)
export class VideoCommunityController {
  constructor(private readonly videoCommunityService: VideoCommunityService) {}

  @ApiOperation({
    summary: 'Coach posts a video (video_url must reference uploaded file)',
  })
  @Post('post')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'video', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ], {
      storage: memoryStorage(),
    }),
  )
  async communityPost(
    @GetUser('userId') coachId: string,
    @Body() body: CreatePostDto,
    @UploadedFiles()
    files?: {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    const video = files?.video?.[0];
    const thumbnail = files?.thumbnail?.[0];

    if (!coachId) {
      throw new Error('Invalid coachId or file');
    }

    return this.videoCommunityService.communityPost(
      coachId,
      body,
      video,
      thumbnail,
    );
  }

  @ApiOperation({
    summary: 'List video community posts (restricted by subscription)',
  })
  @Get('list')
  @UseGuards(hasSubscribers)
  async list(
    @GetUser('userId') userId: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const opts = {
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
    };
    return this.videoCommunityService.listVideos(userId, opts);
  }

  @ApiOperation({ summary: 'Get single video details (increments view count)' })
  @Get(':id')
  async getOne(@GetUser('userId') userId: string, @Param('id') id: string) {
    return this.videoCommunityService.getVideo(userId, id);
  }
}
