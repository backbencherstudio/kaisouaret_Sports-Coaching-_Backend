import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Express } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBadgeManagementDto } from './dto/create-badge-management.dto';
import { UpdateBadgeManagementDto } from './dto/update-badge-management.dto';
import { SazedStorage } from '../../../common/lib/Disk/SazedStorage';
import appConfig from '../../../config/app.config';
import { StringHelper } from '../../../common/helper/string.helper';

@Injectable()
export class BadgeManagementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new badge
   */
  async createBadge(
    createBadgeManagementDto: CreateBadgeManagementDto,
    icon?: Express.Multer.File,
  ) {
    try {
      console.log('badge data', createBadgeManagementDto);
      // Check if badge with same key already exists
      const existingBadge = await this.prisma.badge.findUnique({
        where: { key: createBadgeManagementDto.key },
      });

      if (existingBadge) {
        throw new BadRequestException(
          `Badge with key '${createBadgeManagementDto.key}' already exists`,
        );
      }

      let iconFileName: string | undefined = createBadgeManagementDto.icon;

      // Upload icon if provided
      if (icon) {
        try {
          // Validate icon file
          if (!icon.buffer || icon.buffer.length === 0) {
            throw new BadRequestException(
              `Invalid icon file: ${icon.originalname} has no content`,
            );
          }

          if (icon.size > 5 * 1024 * 1024) {
            // 5MB limit for icons
            throw new BadRequestException(
              `Icon file too large: ${icon.originalname} (${icon.size} bytes). Max 5MB allowed.`,
            );
          }

          const fileName = `badge_${StringHelper.randomString()}_${icon.originalname}`;
          const uploadPath = appConfig().storageUrl.photo + '/' + fileName;

          console.log(`Uploading badge icon: ${fileName} (${icon.size} bytes)`);
          await SazedStorage.put(uploadPath, icon.buffer);
          iconFileName = fileName;
          console.log('Badge icon uploaded successfully:', fileName);
        } catch (uploadError) {
          console.error(`Failed to upload badge icon:`, uploadError);
          if (uploadError instanceof BadRequestException) {
            throw uploadError;
          }
          throw new BadRequestException(
            `Icon upload failed: ${uploadError.message || 'Unknown error'}`,
          );
        }
      }

      const badge = await this.prisma.badge.create({
        data: {
          key: createBadgeManagementDto.key,
          title: createBadgeManagementDto.title,
          description: createBadgeManagementDto.description,
          points: createBadgeManagementDto.points ?? 0,
          icon: iconFileName,
          criteria: createBadgeManagementDto.criteria || null,
        },
      });

      // Serialize icon URL for response
      const badgeData = {
        ...badge,
        icon_url: badge.icon
          ? SazedStorage.url(appConfig().storageUrl.photo + '/' + badge.icon)
          : null,
      };

      return {
        success: true,
        message: 'Badge created successfully',
        data: badgeData,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to create badge');
    }
  }

  /**
   * Get all badges with statistics
   */
  async findAllBadges() {
    try {
      const badges = await this.prisma.badge.findMany({
        orderBy: { created_at: 'asc' },
        include: {
          _count: {
            select: {
              user_badges: true, // Count how many users have earned this badge
            },
          },
        },
      });

      const formattedBadges = badges.map((badge) => ({
        id: badge.id,
        key: badge.key,
        title: badge.title,
        description: badge.description,
        points: badge.points,
        icon: badge.icon,
        icon_url: badge.icon
          ? SazedStorage.url(appConfig().storageUrl.photo + '/' + badge.icon)
          : null,
        criteria: badge.criteria,
        users_earned: badge._count.user_badges,
        created_at: badge.created_at,
        updated_at: badge.updated_at,
      }));

      return {
        success: true,
        message: `Retrieved ${badges.length} badge(s)`,
        data: formattedBadges,
        total: badges.length,
      };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to fetch badges');
    }
  }

  /**
   * Get a single badge by ID with statistics
   */
  async findOneBadge(id: string) {
    try {
      const badge = await this.prisma.badge.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              user_badges: true,
            },
          },
          user_badges: {
            take: 10, // Get last 10 users who earned this badge
            orderBy: { earned_at: 'desc' },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
            },
          },
        },
      });

      if (!badge) {
        throw new NotFoundException(`Badge with ID '${id}' not found`);
      }

      return {
        success: true,
        message: 'Badge retrieved successfully',
        data: {
          id: badge.id,
          key: badge.key,
          title: badge.title,
          description: badge.description,
          points: badge.points,
          icon: badge.icon,
          icon_url: badge.icon
            ? SazedStorage.url(appConfig().storageUrl.photo + '/' + badge.icon)
            : null,
          criteria: badge.criteria,
          users_earned: badge._count.user_badges,
          created_at: badge.created_at,
          updated_at: badge.updated_at,
          recent_earners: badge.user_badges.map((ub) => ({
            user_id: ub.user.id,
            user_name: ub.user.name,
            user_email: ub.user.email,
            user_avatar: ub.user.avatar,
            earned_at: ub.earned_at,
          })),
        },
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to fetch badge');
    }
  }

  /**
   * Update a badge by ID
   */
  async updateBadge(
    id: string,
    updateBadgeManagementDto: UpdateBadgeManagementDto,
    icon?: Express.Multer.File,
  ) {
    try {
      // Check if badge exists
      const existingBadge = await this.prisma.badge.findUnique({
        where: { id },
      });

      if (!existingBadge) {
        throw new NotFoundException(`Badge with ID '${id}' not found`);
      }

      // If updating key, check if new key is already in use by another badge
      if (
        updateBadgeManagementDto.key &&
        updateBadgeManagementDto.key !== existingBadge.key
      ) {
        const keyExists = await this.prisma.badge.findUnique({
          where: { key: updateBadgeManagementDto.key },
        });

        if (keyExists) {
          throw new BadRequestException(
            `Badge with key '${updateBadgeManagementDto.key}' already exists`,
          );
        }
      }

      const updateData: any = {};
      if (updateBadgeManagementDto.key !== undefined)
        updateData.key = updateBadgeManagementDto.key;
      if (updateBadgeManagementDto.title !== undefined)
        updateData.title = updateBadgeManagementDto.title;
      if (updateBadgeManagementDto.description !== undefined)
        updateData.description = updateBadgeManagementDto.description;
      if (updateBadgeManagementDto.points !== undefined)
        updateData.points = updateBadgeManagementDto.points;
      if (updateBadgeManagementDto.criteria !== undefined)
        updateData.criteria = updateBadgeManagementDto.criteria;

      // Handle icon upload if new icon provided
      if (icon) {
        try {
          // Validate icon file
          if (!icon.buffer || icon.buffer.length === 0) {
            throw new BadRequestException(
              `Invalid icon file: ${icon.originalname} has no content`,
            );
          }

          if (icon.size > 5 * 1024 * 1024) {
            // 5MB limit
            throw new BadRequestException(
              `Icon file too large: ${icon.originalname} (${icon.size} bytes). Max 5MB allowed.`,
            );
          }

          // Delete old icon if exists
          if (existingBadge.icon) {
            try {
              const oldIconPath =
                appConfig().storageUrl.photo + '/' + existingBadge.icon;
              await SazedStorage.delete(oldIconPath);
              console.log('Deleted old badge icon:', existingBadge.icon);
            } catch (deleteError) {
              console.warn('Failed to delete old icon:', deleteError);
              // Don't throw, continue with upload
            }
          }

          // Upload new icon
          const fileName = `badge_${StringHelper.randomString()}_${icon.originalname}`;
          const uploadPath = appConfig().storageUrl.photo + '/' + fileName;

          console.log(`Uploading badge icon: ${fileName} (${icon.size} bytes)`);
          await SazedStorage.put(uploadPath, icon.buffer);
          updateData.icon = fileName;
          console.log('Badge icon uploaded successfully:', fileName);
        } catch (uploadError) {
          console.error(`Failed to upload badge icon:`, uploadError);
          if (uploadError instanceof BadRequestException) {
            throw uploadError;
          }
          throw new BadRequestException(
            `Icon upload failed: ${uploadError.message || 'Unknown error'}`,
          );
        }
      } else if (updateBadgeManagementDto.icon !== undefined) {
        updateData.icon = updateBadgeManagementDto.icon;
      }

      const badge = await this.prisma.badge.update({
        where: { id },
        data: updateData,
      });

      // Serialize icon URL for response
      const badgeData = {
        ...badge,
        icon_url: badge.icon
          ? SazedStorage.url(appConfig().storageUrl.photo + '/' + badge.icon)
          : null,
      };

      return {
        success: true,
        message: 'Badge updated successfully',
        data: badgeData,
      };
    } catch (error: any) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to update badge');
    }
  }

  /**
   * Delete a badge by ID
   */
  async deleteBadge(id: string) {
    try {
      const badge = await this.prisma.badge.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              user_badges: true,
            },
          },
        },
      });

      if (!badge) {
        throw new NotFoundException(`Badge with ID '${id}' not found`);
      }

      // Check if any users have earned this badge
      if (badge._count.user_badges > 0) {
        throw new BadRequestException(
          `Cannot delete badge '${badge.title}' because ${badge._count.user_badges} user(s) have earned it. Consider deactivating instead.`,
        );
      }

      await this.prisma.badge.delete({
        where: { id },
      });

      return {
        success: true,
        message: `Badge '${badge.title}' deleted successfully`,
      };
    } catch (error: any) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to delete badge');
    }
  }
}
