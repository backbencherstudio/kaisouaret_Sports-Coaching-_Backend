import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { QueryUserListDto, UserRole, UserStatus } from './dto/query-user-list.dto';
import { UpdateUserListDto } from './dto/update-user-list.dto';
import { SazedStorage } from '../../../../common/lib/disk/SazedStorage';
import { StringHelper } from '../../../../common/helper/string.helper';
import appConfig from '../../../../config/app.config';

@Injectable()
export class UserListService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(queryDto: QueryUserListDto) {
    try {
      const {
        search,
        role,
        status,
        page = 1,
        limit = 10,
      } = queryDto;
      const andConditions: any[] = [
        { deleted_at: null },
      ];
      if (search) {
        andConditions.push({
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        });
      }
      if (role) {
        if (role === UserRole.COACH) {
          andConditions.push({ type: 'coach' });
        } else if (role === UserRole.ATHLETE) {
          andConditions.push({ type: 'user' });
        }
      }
      if (status) {
        if (status === UserStatus.ACTIVE) {
          andConditions.push({ status: 1 });
        } else if (status === UserStatus.BLOCKED) {
          andConditions.push({
            OR: [
              { status: 0 },
              { status: null },
            ],
          });
        }
      }
      const where_condition = andConditions.length > 1
        ? { AND: andConditions }
        : andConditions[0];
      const skip = (page - 1) * limit;
      const take = Math.min(limit, 100); 
      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where: where_condition,
          select: {
            id: true,
            name: true,
            email: true,
            type: true,
            status: true,
            avatar: true,
            created_at: true,
          },
          orderBy: {
            created_at: 'desc',
          },
          skip,
          take,
        }),
        this.prisma.user.count({
          where: where_condition,
        }),
      ]);
      const formattedUsers = users.map((user) => ({
        id: user.id,
        user_name: user.name,
        role: user.type === 'coach' ? 'Coach' : 'Athlete',
        email: user.email,
        joining_date: user.created_at,
        status: user.status === 1 ? 'Active' : 'Blocked',
        avatar: user.avatar,
      }));
      const total_pages = Math.ceil(total / take);
      const has_next_page = page < total_pages;
      const has_previous_page = page > 1;

      return {
        success: true,
        data: formattedUsers,
        pagination: {
          page,
          limit: take,
          total,
          total_pages,
          has_next_page,
          has_previous_page,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        data: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          total_pages: 0,
          has_next_page: false,
          has_previous_page: false,
        },
      };
    }
  }

  async findOne(id: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: id,
          deleted_at: null,
        },
        include: {
          coach_profile: {
            include: {
              coach_reviews: {
                where: {
                  deleted_at: null,
                },
                select: {
                  id: true,
                  rating: true,
                },
              },
            },
          },
          bookings: {
            where: {
              deleted_at: null,
            },
            select: {
              id: true,
              status: true,
              created_at: true,
            },
          },
        },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      let userBadges: any[] = [];
      try {
        userBadges = await (this.prisma as any).userBadge.findMany({
          where: {
            user_id: id,
          },
          include: {
            badge: true,
          },
          orderBy: {
            earned_at: 'desc',
          },
        });
      } catch (badgeError: any) {
        console.warn('Could not fetch user badges:', badgeError?.message || 'Unknown error');
        userBadges = [];
      }

      const userWithBadges = {
        ...user,
        user_badges: userBadges,
      };

      if (user.type === 'coach') {
        return this.formatCoachDetails(userWithBadges);
      } else {
        return this.formatAthleteDetails(userWithBadges);
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  private formatCoachDetails(user: any) {
    const coachProfile = user.coach_profile;
    const reviews = coachProfile?.coach_reviews || [];
    const badges = user.user_badges || [];
    const bookings = user.bookings || [];

    const totalSessions = bookings.length;
    const completedSessions = bookings.filter(
      (b: any) => b.status === 'COMPLETED',
    ).length;

    const avgRating = coachProfile?.avg_rating
      ? Number(coachProfile.avg_rating)
      : null;
    const ratingCount = coachProfile?.rating_count || reviews.length;

    const experienceYears = user.created_at
      ? Math.floor(
          (new Date().getTime() - new Date(user.created_at).getTime()) /
            (1000 * 60 * 60 * 24 * 365),
        )
      : 0;

    const languages = user.location
      ? [user.location]
      : []; // You may need to add a languages field to the schema

    return {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: 'Coach',
        description: user.bio || coachProfile?.primary_specialty || '',
        specialties: coachProfile?.specialties || [],
        primary_specialty: coachProfile?.primary_specialty || null,
        rating: avgRating,
        rating_count: ratingCount,
        badges: badges.map((ub: any) => ({
          id: ub.badge.id,
          key: ub.badge.key,
          title: ub.badge.title,
          description: ub.badge.description,
          icon: ub.badge.icon,
          earned_at: ub.earned_at,
        })),
        certifications: coachProfile?.certifications || [],
        statistics: {
          sessions: `${totalSessions}+ Session`,
          experience: `${experienceYears}+ Experience`,
          languages: `${languages.length > 0 ? languages.length : 1}+ Languages`,
        },
        experience_level: coachProfile?.experience_level || null,
        hourly_rate: coachProfile?.hourly_rate
          ? Number(coachProfile.hourly_rate)
          : null,
        hourly_currency: coachProfile?.hourly_currency || null,
        session_price: coachProfile?.session_price
          ? Number(coachProfile.session_price)
          : null,
        session_duration_minutes: coachProfile?.session_duration_minutes || 60,
        is_verified: coachProfile?.is_verified === 1,
        created_at: user.created_at,
        joining_date: user.created_at,
      },
    };
  }

  private formatAthleteDetails(user: any) {
    const bookings = user.bookings || [];
    const completedBookings = bookings.filter(
      (b: any) => b.status === 'COMPLETED',
    );

    const level = 'Intermediate';
    const demographics = [
      user.age ? `${user.age}` : null,
      user.gender || null,
      level,
    ]
      .filter(Boolean)
      .join(' - ');

    const goals = user.goals
      ? user.goals.split(',').map((g: string) => g.trim()).filter(Boolean)
      : [];

    return {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: 'Athlete',
        description: user.bio || '',
        demographics: demographics || null,
        age: user.age,
        gender: user.gender,
        level: level,
        sports: user.sports || null,
        objectives: user.objectives || null,
        goals: goals,
        current_goals: goals,
        statistics: {
          sessions_completed: completedBookings.length,
          total_sessions: bookings.length,
        },
        location: user.location || null,
        phone_number: user.phone_number || null,
        created_at: user.created_at,
        joining_date: user.created_at,
      },
    };
  }

  async update(id: string, updateUserListDto: UpdateUserListDto, image?: Express.Multer.File) {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: id,
          deleted_at: null,
        },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      const updateData: any = {};

      if (updateUserListDto.name !== undefined) {
        updateData.name = updateUserListDto.name;
      }

      if (updateUserListDto.email !== undefined) {
        updateData.email = updateUserListDto.email;
      }

      if (updateUserListDto.phone_number !== undefined) {
        updateData.phone_number = updateUserListDto.phone_number;
      }

      if (updateUserListDto.status !== undefined) {
        updateData.status = updateUserListDto.status === UserStatus.ACTIVE ? 1 : 0;
      }

      if (updateUserListDto.bio !== undefined) {
        updateData.bio = updateUserListDto.bio;
      }

      if (updateUserListDto.location !== undefined) {
        updateData.location = updateUserListDto.location;
      }

      if (updateUserListDto.address !== undefined) {
        updateData.address = updateUserListDto.address;
      }

      if (updateUserListDto.gender !== undefined) {
        updateData.gender = updateUserListDto.gender;
      }

      if (updateUserListDto.age !== undefined) {
        updateData.age = updateUserListDto.age;
      }

      if (image) {
        try {
          if (user.avatar) {
            const oldAvatarKey = `${appConfig().storageUrl.avatar}/${user.avatar}`;
            await SazedStorage.delete(oldAvatarKey);
          }

          const fileName = `${StringHelper.randomString()}${image.originalname}`;
          const avatarKey = `${appConfig().storageUrl.avatar}/${fileName}`;
          await SazedStorage.put(
            avatarKey,
            image.buffer,
          );

          updateData.avatar = fileName;
        } catch (imageError: any) {
          return {
            success: false,
            message: `Failed to upload image: ${imageError.message}`,
          };
        }
      }

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          message: 'No fields to update',
        };
      }

      updateData.updated_at = new Date();

      const updatedUser = await this.prisma.user.update({
        where: { id: id },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          status: true,
          bio: true,
          location: true,
          address: true,
          gender: true,
          age: true,
          type: true,
          avatar: true,
          created_at: true,
          updated_at: true,
        },
      });

      const responseData: any = {
        ...updatedUser,
        role: updatedUser.type === 'coach' ? 'Coach' : 'Athlete',
        status: updatedUser.status === 1 ? 'Active' : 'Blocked',
      };

      if (updatedUser.avatar) {
        const avatarKey = `${appConfig().storageUrl.avatar}/${updatedUser.avatar}`;
        const url = SazedStorage.url(avatarKey.startsWith('/') ? avatarKey.substring(1) : avatarKey);
        responseData.avatar_url = url;
      }

      return {
        success: true,
        message: 'User updated successfully',
        data: responseData,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to update user',
      };
    }
  }

  async remove(id: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: id,
        },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      if (user.avatar) {
        try {
          const avatarKey = `${appConfig().storageUrl.avatar}/${user.avatar}`;
          await SazedStorage.delete(avatarKey);
        } catch (storageError: any) {
          console.warn(`Failed to delete avatar file for user ${id}:`, storageError?.message || 'Unknown error');
        }
      }
      await this.prisma.user.delete({
        where: { id: id },
      });

      return {
        success: true,
        message: 'User permanently deleted successfully',
      };
    } catch (error: any) {
      if (error.code === 'P2003') {
        return {
          success: false,
          message: 'Cannot delete user: user has related records that prevent deletion',
        };
      }

      return {
        success: false,
        message: error.message || 'Failed to delete user',
      };
    }
  }
}
