import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as ffmpegModule from 'fluent-ffmpeg';
import * as ffprobeStatic from 'ffprobe-static';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePostDto } from './dto/video-community-create.dto';
import { SazedStorage } from 'src/common/lib/Disk/SazedStorage';
import appConfig from 'src/config/app.config';
import { StringHelper } from 'src/common/helper/string.helper';

type ListOptions = { page?: number; perPage?: number };

const ffmpeg =
  ((ffmpegModule as unknown as { default?: typeof ffmpegModule }).default ||
    ffmpegModule) as typeof ffmpegModule;

const ffprobePath =
  (ffprobeStatic as { path?: string }).path ||
  (ffprobeStatic as { default?: { path?: string } }).default?.path;

if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
}

@Injectable()
export class VideoCommunityService {
  constructor(private readonly prisma: PrismaService) {}

  private async extractVideoDuration(video: Express.Multer.File): Promise<number> {
    if (!video?.buffer?.length) {
      throw new BadRequestException('Uploaded video file is empty');
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'video-community-'));
    const safeName = video.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.\s-_]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    const tempFilePath = join(
      tempDir,
      `${StringHelper.randomString()}-${safeName || 'upload-video'}`,
    );

    try {
      await writeFile(tempFilePath, video.buffer);

      const duration = await new Promise<number>((resolve, reject) => {
        ffmpeg.ffprobe(tempFilePath, (error, metadata) => {
          if (error) {
            reject(error);
            return;
          }

          const seconds = metadata?.format?.duration;
          if (!seconds || Number.isNaN(seconds)) {
            reject(new Error('Unable to detect video duration'));
            return;
          }

          resolve(Math.max(1, Math.round(seconds)));
        });
      });

      return duration;
    } catch (error) {
      throw new BadRequestException(
        `Failed to extract video duration: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async hasActiveAthleteSubscription(userId: string): Promise<boolean> {
    if (!userId) return false;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { type: true },
    });

    if (!user) return false;
    if (user.type === 'coach') return true;

    const now = new Date();
    const activeSubscription = await this.prisma.userSubscription.findFirst({
      where: {
        user_id: userId,
        status: 'active',
        deleted_at: null,
        current_period_end: { gte: now },
        plan: { kind: 'ATHLETE' },
      },
      select: { id: true },
    });

    return !!activeSubscription;
  }

  // coach posts a video entry (the actual video file is expected to be uploaded separately and stored under video_url)
  async communityPost(
    coachId: string,
    dto: CreatePostDto,
    video?: Express.Multer.File,
    thumbnail?: Express.Multer.File,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    const user = await this.prisma.user.findUnique({ where: { id: coachId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.type !== 'coach')
      throw new ForbiddenException('Only coaches can post videos');

    if (!video?.buffer && !dto.video_url) {
      throw new BadRequestException('Video file or video_url is required');
    }

    let mediaUrl: string | undefined = undefined;
    let thumbnailUrl: string | undefined = undefined;
    let videoDuration: number | null = null;

    // upload file to s3 or minIO
    if (video?.buffer) {
      try {
        if (!video.mimetype?.startsWith('video/')) {
          throw new BadRequestException('Uploaded file must be a video');
        }

        videoDuration = await this.extractVideoDuration(video);

        const fileName = `${StringHelper.randomString()}${video.originalname}`;
        await SazedStorage.put(
          appConfig().storageUrl.video + '/' + fileName,
          video.buffer,
        );
        console.log('fileName: ', fileName);

        // set video url
        mediaUrl = SazedStorage.url(
          appConfig().storageUrl.video + '/' + fileName,
        );
      } catch (error) {
        console.error('Failed to upload video:', error);
        throw new Error(`Failed to upload video: ${error.message}`);
      }
    } else if (dto.video_url) {
      mediaUrl = dto.video_url;
      videoDuration = dto.duration ?? null;
    }

    // upload thumbnail image
    if (thumbnail?.buffer) {
      try {
        const safeName = thumbnail.originalname
          .toLowerCase()
          .replace(/[^a-z0-9.\s-_]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');

        const fileName = `${StringHelper.randomString()}-${safeName}`;
        const key = `${appConfig().storageUrl.thumbnail}/${fileName}`;

        await SazedStorage.put(key, thumbnail.buffer);

        thumbnailUrl = SazedStorage.url(encodeURI(key));
      } catch (error) {
        console.error('Failed to upload thumbnail:', error);
        throw new Error(`Failed to upload thumbnail: ${error.message}`);
      }
    } else if (dto.thumbnail_key) {
      thumbnailUrl = dto.thumbnail_key;
    }

    const postData = await this.prisma.video.create({
      data: {
        coach_id: coachId,
        title: dto.title,
        duration: videoDuration,
        description: dto.description || null,
        video_url: mediaUrl || '',
        thumbnail: thumbnailUrl || null,
        // is_premium: dto.is_premium || false,
      },
      select: {
        id: true,
        title: true,
        description: true,
        video_url: true,
        thumbnail: true,
        duration: true,
        is_premium: true,
        created_at: true,
      },
    });

    return {
      success: true,
      message: 'Video post created successfully',
      data: postData,
    };
  }

  // list videos visible to the requesting user
  async listVideos(requestingUserId: string, opts: ListOptions = {}) {
    if (!requestingUserId) throw new BadRequestException('User ID is required');

    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const perPage = opts.perPage && opts.perPage > 0 ? opts.perPage : 10;

    const isPremium = await this.hasActiveAthleteSubscription(requestingUserId);

    const where: any = {};
    if (!isPremium) {
      // non-premium users only see non-premium videos
      where.is_premium = false;
    }

    const [videos, total] = await Promise.all([
      this.prisma.video.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          title: true,
          description: true,
          video_url: true,
          thumbnail: true,
          duration: true,
          view_count: true,
          is_premium: true,
          created_at: true,
          coach: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      }),
      this.prisma.video.count({ where }),
    ]);

    return {
      success: true,
      message: 'Videos retrieved successfully',
      data: {
        videos,
        pagination: {
          page,
          perPage,
          total,
          totalPages: Math.ceil(total / perPage),
        },
        isPremium,
      },
    };
  }

  async getVideo(requestingUserId: string, videoId: string) {
    if (!requestingUserId) throw new BadRequestException('User ID is required');
    if (!videoId) throw new BadRequestException('Video ID is required');

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: {
        coach: {
          select: {
            id: true,
            name: true,
            avatar: true,
            bio: true,
            coach_profile: {
              select: {
                id: true,
                primary_specialty: true,
                specialties: true,
                certifications: true,
                experience_level: true,
                is_verified: true,
                avg_rating: true,
                rating_count: true,
              },
            },
          },
        },
      },
    });
    if (!video) throw new NotFoundException('Video not found');

    if (video.is_premium) {
      const ok = await this.hasActiveAthleteSubscription(requestingUserId);
      if (!ok)
        throw new ForbiddenException(
          'This video is for subscribed athletes only',
        );
    }

    // increment view count (fire-and-forget)
    try {
      await this.prisma.video.update({
        where: { id: videoId },
        data: { view_count: (video.view_count || 0) + 1 },
      });
    } catch (err) {
      console.warn('Failed to increment video view count', err);
    }

    return {
      success: true,
      message: 'Video details retrieved successfully',
      data: video,
    };
  }
}
