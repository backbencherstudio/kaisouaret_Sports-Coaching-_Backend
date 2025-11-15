import {
  Body,
  Controller,
  Post,
  UseGuards,
  Get,
  Query,
  Param,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { VideoCommunityService } from './video-community.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CreatePostDto } from './dto/video-community-create.dto';
import { memoryStorage } from 'multer';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('video-community')
@ApiTags('video-community')
@UseGuards(JwtAuthGuard)
export class VideoCommunityController {
  constructor(private readonly videoCommunityService: VideoCommunityService) {}

  @ApiOperation({
    summary: 'Coach posts a video (video_key must reference uploaded file)',
  })
  @Post('post')
  @UseInterceptors(
    FileInterceptor('media', {
      storage: memoryStorage(),
    }),
  )
  async communityPost(
    @GetUser('userId') coachId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreatePostDto,
  ) {
    if (!coachId && !file) {
      throw new Error('Invalid coachId or file');
    }

    return this.videoCommunityService.communityPost(coachId, body, file);
  }

  @ApiOperation({
    summary: 'List video community posts (restricted by subscription)',
  })
  @Get('list')
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
