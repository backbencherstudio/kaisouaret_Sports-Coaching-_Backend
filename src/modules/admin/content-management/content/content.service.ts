import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class ContentService {
  constructor(private prisma: PrismaService) {}

  async getCoachList() {
    try {
      const coaches = await this.prisma.user.findMany({
        where: {
          deleted_at: null,
          coach_profile: {
            isNot: null,
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          status: true,
          approved_at: true,
          created_at: true,
          coach_profile: {
            select: {
              id: true,
              status: true,
              primary_specialty: true,
              specialties: true,
              experience_level: true,
              avg_rating: true,
              rating_count: true,
              is_verified: true,
              subscription_active: true,
            },
          },
          _count: {
            select: {
              bookings: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });
      const formattedCoaches = coaches.map((coach) => ({
        id: coach.id,
        name: coach.name || 'N/A',
        email: coach.email || 'N/A',
        avatar: coach.avatar || null,
        status: coach.status === 1 ? 'Active' : 'Inactive',
        approved_at: coach.approved_at,
        created_at: coach.created_at,
        session_count: coach._count.bookings,
        coach_profile: coach.coach_profile
          ? {
              id: coach.coach_profile.id,
              primary_specialty: coach.coach_profile.primary_specialty,
              specialties: coach.coach_profile.specialties,
              experience_level: coach.coach_profile.experience_level,
              avg_rating: coach.coach_profile.avg_rating,
              rating_count: coach.coach_profile.rating_count,
              is_verified: coach.coach_profile.is_verified === 1,
              subscription_active: coach.coach_profile.subscription_active === 1,
            }
          : null,
      }));

      return {
        success: true,
        data: formattedCoaches,
        total: formattedCoaches.length,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to fetch coach list',
      };
    }
  }

  async getSessionValidationList() {
    try {
      const bookings = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
        },
        select: {
          id: true,
          appointment_date: true,
          session_time: true,
          status: true,
          validation_token: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
              type: true,
            },
          },
          coach_profile: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                  type: true,
                },
              },
            },
          },
        },
        orderBy: {
          appointment_date: 'desc',
        },
      });
      const formattedSessions = bookings.map((booking) => {
        const appointmentDate = booking.appointment_date
          ? new Date(booking.appointment_date)
          : null;
        const formattedDate = appointmentDate
          ? `${appointmentDate.getMonth() + 1}/${appointmentDate.getDate()}/${appointmentDate.getFullYear()}`
          : 'N/A';
        const sessionTime = booking.session_time
          ? new Date(booking.session_time)
          : appointmentDate;
        const formattedTime = sessionTime
          ? `${sessionTime.getHours().toString().padStart(2, '0')}:${sessionTime.getMinutes().toString().padStart(2, '0')}`
          : 'N/A';

        return {
          id: booking.id,
          athlete: {
            id: booking.user.id,
            name: booking.user.name || 'N/A',
            email: booking.user.email || 'N/A',
            avatar: booking.user.avatar || null,
            role: 'Athlete',
            type: booking.user.type || 'user',
          },
          coach: booking.coach_profile?.user
            ? {
                id: booking.coach_profile.user.id,
                name: booking.coach_profile.user.name || 'N/A',
                email: booking.coach_profile.user.email || 'N/A',
                avatar: booking.coach_profile.user.avatar || null,
                role: 'Coach',
                type: booking.coach_profile.user.type || 'coach',
              }
            : null,
          session: {
            date: formattedDate,
            time: formattedTime,
            date_time: `${formattedDate} • ${formattedTime}`,
            appointment_date: booking.appointment_date,
            session_time: booking.session_time,
          },
          status: booking.status,
          validation_token: booking.validation_token,
          is_validated: !!booking.validation_token,
        };
      });

      return {
        success: true,
        data: formattedSessions,
        total: formattedSessions.length,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to fetch session validation list',
      };
    }
  }

  async getContentApprovalList() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const coachProfiles = await this.prisma.coachProfile.findMany({
        where: {
          updated_at: {
            gte: thirtyDaysAgo,
          },
          user: {
            deleted_at: null,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
              bio: true,
              approved_at: true,
            },
          },
        },
        orderBy: {
          updated_at: 'desc',
        },
      });
      const formattedContent = coachProfiles.map((profile) => {
        const wasRecentlyUpdated = profile.updated_at > profile.created_at;
        let updateType = 'Profile Update';
        let description = 'Updated profile information';
        
        if (profile.certifications && profile.certifications.length > 0) {
          updateType = 'New Specialization';
          description = `${profile.certifications[profile.certifications.length - 1]} certification added`;
        } else if (profile.user.bio) {
          updateType = 'Bio Update';
          description = `Updated professional bio${profile.certifications && profile.certifications.length > 0 ? ' with new certifications' : ''}...`;
        } else if (profile.specialties && profile.specialties.length > 0) {
          updateType = 'New Specialization';
          description = `${profile.specialties[profile.specialties.length - 1]} specialization added`;
        }

        return {
          id: profile.id,
          user_id: profile.user.id,
          title: `${profile.user.name || 'Unknown'} - ${updateType}`,
          description: description,
          coach_name: profile.user.name || 'N/A',
          coach_email: profile.user.email || 'N/A',
          coach_avatar: profile.user.avatar || null,
          update_type: updateType,
          updated_at: profile.updated_at,
          created_at: profile.created_at,
          is_pending: !profile.user.approved_at || wasRecentlyUpdated,
          profile_data: {
            primary_specialty: profile.primary_specialty,
            specialties: profile.specialties,
            certifications: profile.certifications,
            experience_level: profile.experience_level,
            bio: profile.user.bio,
          },
        };
      });
      const pendingContent = formattedContent.filter((item) => item.is_pending);

      return {
        success: true,
        data: pendingContent,
        total: pendingContent.length,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to fetch content approval list',
      };
    }
  }

  async approveContent(id: string, type: string = 'coach_profile') {
    try {
      if (type === 'coach_profile') {
        const coachProfile = await this.prisma.coachProfile.findUnique({
          where: { id },
          select: { user_id: true },
        });

        if (!coachProfile) {
          return {
            success: false,
            message: 'Coach profile not found',
          };
        }

        await this.prisma.user.update({
          where: { id: coachProfile.user_id },
          data: { approved_at: new Date() },
        });

        return {
          success: true,
          message: 'Content approved successfully',
        };
      } else if (type === 'user') {
        const user = await this.prisma.user.findUnique({
          where: { id },
        });

        if (!user) {
          return {
            success: false,
            message: 'User not found',
          };
        }

        await this.prisma.user.update({
          where: { id },
          data: { approved_at: new Date() },
        });

        return {
          success: true,
          message: 'Content approved successfully',
        };
      } else {
        return {
          success: false,
          message: 'Invalid type. Use "coach_profile" or "user"',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to approve content',
      };
    }
  }

  async rejectContent(id: string, type: string = 'coach_profile', reason?: string) {
    try {
      if (type === 'coach_profile') {
        const coachProfile = await this.prisma.coachProfile.findUnique({
          where: { id },
          select: { user_id: true },
        });

        if (!coachProfile) {
          return {
            success: false,
            message: 'Coach profile not found',
          };
        }

        await this.prisma.user.update({
          where: { id: coachProfile.user_id },
          data: { approved_at: null },
        });

        return {
          success: true,
          message: reason ? `Content rejected: ${reason}` : 'Content rejected successfully',
        };
      } else if (type === 'user') {
        const user = await this.prisma.user.findUnique({
          where: { id },
        });

        if (!user) {
          return {
            success: false,
            message: 'User not found',
          };
        }

        await this.prisma.user.update({
          where: { id },
          data: { approved_at: null },
        });

        return {
          success: true,
          message: reason ? `Content rejected: ${reason}` : 'Content rejected successfully',
        };
      } else {
        return {
          success: false,
          message: 'Invalid type. Use "coach_profile" or "user"',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to reject content',
      };
    }
  }
}
