import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Express } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBadgeManagementDto } from './dto/create-badge-management.dto';
import { UpdateBadgeManagementDto } from './dto/update-badge-management.dto';
import { SazedStorage } from '../../../common/lib/Disk/SazedStorage';
import appConfig from '../../../config/app.config';
import { StringHelper } from '../../../common/helper/string.helper';

type BadgeCriteria = Prisma.InputJsonObject;

@Injectable()
export class BadgeManagementService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly supportedCriteriaFields = new Set([
    'completed_bookings',
    'completed_booking_days',
    'goals',
    'goals_count',
    'user_goals',
    'earned_badge_points',
    'badge_points',
    'earned_badges',
    'earned_badges_count',
  ]);

  private serializeBadge<T extends { icon?: string | null }>(badge: T) {
    return {
      ...badge,
      icon_url: badge.icon
        ? SazedStorage.url(appConfig().storageUrl.photo + '/' + badge.icon)
        : null,
    };
  }

  private validateCriteriaNode(criteria: unknown, path = 'criteria'): void {
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
      throw new BadRequestException(`${path} must be a valid JSON object`);
    }

    const rule = criteria as BadgeCriteria;

    if (Array.isArray(rule.conditions)) {
      const operator =
        typeof rule.operator === 'string' ? rule.operator : undefined;

      if (!operator || !['all', 'any'].includes(operator)) {
        throw new BadRequestException(
          `${path}.operator must be either 'all' or 'any' when using conditions`,
        );
      }

      if (rule.conditions.length === 0) {
        throw new BadRequestException(
          `${path}.conditions must contain at least one rule`,
        );
      }

      rule.conditions.forEach((condition, index) => {
        this.validateCriteriaNode(condition, `${path}.conditions[${index}]`);
      });
      return;
    }

    if (!rule.type || typeof rule.type !== 'string') {
      throw new BadRequestException(`${path}.type is required`);
    }

    if (!rule.field || typeof rule.field !== 'string') {
      throw new BadRequestException(`${path}.field is required`);
    }

    if (!this.supportedCriteriaFields.has(rule.field)) {
      throw new BadRequestException(
        `${path}.field '${rule.field}' is not supported`,
      );
    }

    if (rule.days !== undefined) {
      if (
        typeof rule.days !== 'number' ||
        !Number.isFinite(rule.days) ||
        rule.days <= 0
      ) {
        throw new BadRequestException(`${path}.days must be a positive number`);
      }
    }

    if (rule.type === 'exists') {
      return;
    }

    const value = Number(rule.value);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(
        `${path}.value must be a positive number for '${rule.type}' criteria`,
      );
    }
  }

  private normalizeCriteria(
    criteria: unknown,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (criteria === undefined) return undefined;
    if (criteria === null) return Prisma.JsonNull;

    this.validateCriteriaNode(criteria);
    return criteria as Prisma.InputJsonValue;
  }

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

      const normalizedCriteria = this.normalizeCriteria(
        createBadgeManagementDto.criteria,
      );

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
          criteria: normalizedCriteria ?? null,
        },
      });

      const badgeData = this.serializeBadge(badge);

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
        ...this.serializeBadge({ icon: badge.icon }),
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
          ...this.serializeBadge({ icon: badge.icon }),
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
        updateData.criteria = this.normalizeCriteria(
          updateBadgeManagementDto.criteria,
        );

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

      const badgeData = this.serializeBadge(badge);

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
