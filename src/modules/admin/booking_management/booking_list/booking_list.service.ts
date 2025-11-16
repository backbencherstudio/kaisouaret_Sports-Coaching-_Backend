import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CreateBookingListDto } from './dto/create-booking_list.dto';
import { UpdateBookingListDto } from './dto/update-booking_list.dto';
import { QueryBookingListDto, BookingStatus } from './dto/query-booking-list.dto';
import { SendBulkNotificationDto, RecipientType } from './dto/send-bulk-notification.dto';
import { SazedStorage } from '../../../../common/lib/disk/SazedStorage';
import { StringHelper } from '../../../../common/helper/string.helper';
import appConfig from '../../../../config/app.config';

@Injectable()
export class BookingListService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createBookingListDto: CreateBookingListDto, image?: Express.Multer.File) {
    try {
      const bookingData: any = {
        title: createBookingListDto.title,
        coach_id: createBookingListDto.coach_id,
        user_id: createBookingListDto.user_id,
        coach_profile_id: createBookingListDto.coach_profile_id,
        appointment_date: createBookingListDto.appointment_date 
          ? new Date(createBookingListDto.appointment_date) 
          : undefined,
        session_time: createBookingListDto.session_time 
          ? new Date(createBookingListDto.session_time) 
          : undefined,
        duration_minutes: createBookingListDto.duration_minutes,
        location: createBookingListDto.location,
        description: createBookingListDto.description,
        notes: createBookingListDto.notes,
        status: createBookingListDto.status || 'PENDING',
        session_package_id: createBookingListDto.session_package_id,
      };
      if (image) {
        try {
          const fileName = `${StringHelper.randomString()}${image.originalname}`;
          const imageKey = `${appConfig().storageUrl.attachment}/${fileName}`;
          await SazedStorage.put(
            imageKey,
            image.buffer,
          );
        } catch (imageError: any) {
          return {
            success: false,
            message: `Failed to upload image: ${imageError.message}`,
          };
        }
      }
      Object.keys(bookingData).forEach(key => {
        if (bookingData[key] === undefined) {
          delete bookingData[key];
        }
      });

      const booking = await this.prisma.booking.create({
        data: bookingData,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
          coach_profile: {
            select: {
              id: true,
              primary_specialty: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      return {
        success: true,
        message: 'Booking created successfully',
        data: booking,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to create booking',
      };
    }
  }

  async findAll(queryDto: QueryBookingListDto) {
    try {
      const {
        search,
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
            { title: { contains: search, mode: 'insensitive' } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { coach_profile: { user: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        });
      }
      if (status) {
        andConditions.push({ status: status });
      }

      const where_condition = andConditions.length > 1
        ? { AND: andConditions }
        : andConditions[0];

      const skip = (page - 1) * limit;
      const take = Math.min(limit, 100);

      const [bookings, total] = await Promise.all([
        this.prisma.booking.findMany({
          where: where_condition,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
            coach_profile: {
              select: {
                id: true,
                primary_specialty: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
          orderBy: {
            created_at: 'desc',
          },
          skip,
          take,
        }),
        this.prisma.booking.count({
          where: where_condition,
        }),
      ]);
      const formattedBookings = bookings.map((booking) => ({
        id: booking.id,
        athlete_name: booking.user?.name || 'N/A',
        athlete_avatar: booking.user?.avatar || null,
        session_type: booking.title || 'N/A',
        coach_name: booking.coach_profile?.user?.name || 'N/A',
        coach_specialization: booking.coach_profile?.primary_specialty || 'N/A',
        date_time: booking.appointment_date 
          ? new Date(booking.appointment_date).toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })
          : 'N/A',
        status: booking.status,
        appointment_date: booking.appointment_date,
        session_time: booking.session_time,
        duration_minutes: booking.duration_minutes,
        location: booking.location,
        description: booking.description,
        notes: booking.notes,
        created_at: booking.created_at,
      }));

      const total_pages = Math.ceil(total / take);
      const has_next_page = page < total_pages;
      const has_previous_page = page > 1;

      return {
        success: true,
        data: formattedBookings,
        pagination: {
          page,
          limit: take,
          total,
          total_pages,
          has_next_page,
          has_previous_page,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to fetch bookings',
      };
    }
  }

  async getMetrics() {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(todayStart);
      const allBookings = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
        },
        select: {
          id: true,
          status: true,
          duration_minutes: true,
          created_at: true,
        },
      });
      const todayBookings = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
          created_at: {
            gte: todayStart,
            lt: todayEnd,
          },
        },
      });
      const yesterdayBookings = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
          created_at: {
            gte: yesterdayStart,
            lt: yesterdayEnd,
          },
        },
      });

      const totalBookingsToday = todayBookings.length;
      const totalBookingsYesterday = yesterdayBookings.length;
      const totalBookingsChange = totalBookingsToday - totalBookingsYesterday;

      const totalBookings = allBookings.length;
      const completedBookings = allBookings.filter(b => b.status === 'COMPLETED').length;
      const currentCompletionRate = totalBookings > 0 
        ? Math.round((completedBookings / totalBookings) * 100) 
        : 0;

      const last7DaysStart = new Date(now);
      last7DaysStart.setDate(last7DaysStart.getDate() - 7);
      const previous7DaysStart = new Date(last7DaysStart);
      previous7DaysStart.setDate(previous7DaysStart.getDate() - 7);
      const previous7DaysEnd = new Date(last7DaysStart);

      const last7DaysBookings = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
          created_at: {
            gte: last7DaysStart,
          },
        },
        select: {
          status: true,
        },
      });

      const previous7DaysBookings = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
          created_at: {
            gte: previous7DaysStart,
            lt: previous7DaysEnd,
          },
        },
        select: {
          status: true,
        },
      });

      const last7DaysCompleted = last7DaysBookings.filter(b => b.status === 'COMPLETED').length;
      const previous7DaysCompleted = previous7DaysBookings.filter(b => b.status === 'COMPLETED').length;
      const last7DaysTotal = last7DaysBookings.length;
      const previous7DaysTotal = previous7DaysBookings.length;

      const last7DaysCompletionRate = last7DaysTotal > 0 
        ? Math.round((last7DaysCompleted / last7DaysTotal) * 100) 
        : 0;
      const previous7DaysCompletionRate = previous7DaysTotal > 0 
        ? Math.round((previous7DaysCompleted / previous7DaysTotal) * 100) 
        : 0;
      const completionRateChange = last7DaysCompletionRate - previous7DaysCompletionRate;

      const bookingsWithDuration = allBookings.filter(b => b.duration_minutes !== null && b.duration_minutes !== undefined);
      const totalDuration = bookingsWithDuration.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);
      const averageSessionDuration = bookingsWithDuration.length > 0 
        ? Math.round(totalDuration / bookingsWithDuration.length) 
        : 0;
      const last7DaysBookingsWithDuration = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
          created_at: {
            gte: last7DaysStart,
          },
          duration_minutes: {
            not: null,
          },
        },
        select: {
          duration_minutes: true,
        },
      });

      const previous7DaysBookingsWithDuration = await this.prisma.booking.findMany({
        where: {
          deleted_at: null,
          created_at: {
            gte: previous7DaysStart,
            lt: previous7DaysEnd,
          },
          duration_minutes: {
            not: null,
          },
        },
        select: {
          duration_minutes: true,
        },
      });

      const last7DaysTotalDuration = last7DaysBookingsWithDuration.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);
      const previous7DaysTotalDuration = previous7DaysBookingsWithDuration.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);
      const last7DaysAvgDuration = last7DaysBookingsWithDuration.length > 0 
        ? Math.round(last7DaysTotalDuration / last7DaysBookingsWithDuration.length) 
        : 0;
      const previous7DaysAvgDuration = previous7DaysBookingsWithDuration.length > 0 
        ? Math.round(previous7DaysTotalDuration / previous7DaysBookingsWithDuration.length) 
        : 0;
      const avgDurationChange = last7DaysAvgDuration - previous7DaysAvgDuration;

      const cancelledBookings = allBookings.filter(b => b.status === 'CANCELLED').length;
      const currentCancellationRate = totalBookings > 0 
        ? Number(((cancelledBookings / totalBookings) * 100).toFixed(1)) 
        : 0;
      const last7DaysCancelled = last7DaysBookings.filter(b => b.status === 'CANCELLED').length;
      const previous7DaysCancelled = previous7DaysBookings.filter(b => b.status === 'CANCELLED').length;
      const last7DaysCancellationRate = last7DaysTotal > 0 
        ? Number(((last7DaysCancelled / last7DaysTotal) * 100).toFixed(1)) 
        : 0;
      const previous7DaysCancellationRate = previous7DaysTotal > 0 
        ? Number(((previous7DaysCancelled / previous7DaysTotal) * 100).toFixed(1)) 
        : 0;
      const cancellationRateChange = Number((last7DaysCancellationRate - previous7DaysCancellationRate).toFixed(1));

      return {
        success: true,
        data: {
          total_bookings_today: {
            value: totalBookingsToday,
            change: totalBookingsChange,
            is_positive: totalBookingsChange >= 0,
          },
          completion_rate: {
            value: last7DaysCompletionRate,
            unit: '%',
            change: completionRateChange,
            is_positive: completionRateChange >= 0,
          },
          average_session_duration: {
            value: last7DaysAvgDuration,
            unit: 'min',
            change: avgDurationChange,
            is_positive: avgDurationChange >= 0,
          },
          cancellation_rate: {
            value: last7DaysCancellationRate,
            unit: '%',
            change: cancellationRateChange,
            is_positive: cancellationRateChange <= 0, // Lower is better for cancellation
          },
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to fetch metrics',
      };
    }
  }

  async sendBulkNotification(sendBulkNotificationDto: SendBulkNotificationDto) {
    try {
      const {
        notification_title,
        message_content,
        recipient_type,
        recipient_ids,
      } = sendBulkNotificationDto;
      if (recipient_type === RecipientType.SPECIFIC) {
        if (!recipient_ids || recipient_ids.length === 0) {
          return {
            success: false,
            message: 'Recipient IDs are required when recipient type is specific',
          };
        }
      }
      let recipientUserIds: string[] = [];

      switch (recipient_type) {
        case RecipientType.ALL:
          const allUsers = await this.prisma.user.findMany({
            where: {
              deleted_at: null,
              status: 1,
            },
            select: {
              id: true,
            },
          });
          recipientUserIds = allUsers.map((user) => user.id);
          break;

        case RecipientType.COACHES:
          const coaches = await this.prisma.user.findMany({
            where: {
              deleted_at: null,
              status: 1,
              type: 'coach',
            },
            select: {
              id: true,
            },
          });
          recipientUserIds = coaches.map((user) => user.id);
          break;

        case RecipientType.ATHLETES:
          const athletes = await this.prisma.user.findMany({
            where: {
              deleted_at: null,
              status: 1,
              type: 'user',
            },
            select: {
              id: true,
            },
          });
          recipientUserIds = athletes.map((user) => user.id);
          break;

        case RecipientType.SPECIFIC:
          if (recipient_ids && recipient_ids.length > 0) {
            const validUsers = await this.prisma.user.findMany({
              where: {
                id: {
                  in: recipient_ids,
                },
                deleted_at: null,
              },
              select: {
                id: true,
              },
            });
            recipientUserIds = validUsers.map((user) => user.id);
            if (validUsers.length !== recipient_ids.length) {
              return {
                success: false,
                message: 'Some recipient IDs are invalid or deleted',
              };
            }
          }
          break;

        default:
          return {
            success: false,
            message: 'Invalid recipient type',
          };
      }

      if (recipientUserIds.length === 0) {
        return {
          success: false,
          message: 'No recipients found for the selected recipient type',
        };
      }
      const notificationText = `${notification_title}: ${message_content}`;

      const notificationEvent = await this.prisma.notificationEvent.create({
        data: {
          type: 'booking',
          text: notificationText,
          status: 1,
        },
      });
      const notificationPromises = recipientUserIds.map(async (receiverId) => {
        return this.prisma.notification.create({
          data: {
            notification_event_id: notificationEvent.id,
            receiver_id: receiverId,
            status: 1,
          },
        });
      });
      const notifications = await Promise.all(notificationPromises);
      return {
        success: true,
        message: `Bulk notification sent successfully to ${notifications.length} recipients`,
        data: {
          notification_title,
          message_content,
          recipient_type,
          total_recipients: notifications.length,
          notifications_created: notifications.length,
          notification_event_id: notificationEvent.id,
          created_at: new Date(),
          sample_notification_ids: notifications.slice(0, 5).map(n => n.id),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to send bulk notifications',
      };
    }
  }

  async checkNotificationStatus(eventId: string) {
    try {
      const notificationEvent = await this.prisma.notificationEvent.findUnique({
        where: {
          id: eventId,
        },
        select: {
          id: true,
          type: true,
          text: true,
          created_at: true,
        },
      });

      if (!notificationEvent) {
        return {
          success: false,
          message: 'Notification event not found',
        };
      }
      const notifications = await this.prisma.notification.findMany({
        where: {
          notification_event_id: eventId,
          deleted_at: null,
        },
        select: {
          id: true,
          receiver_id: true,
          read_at: true,
          created_at: true,
          receiver: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      const totalSent = notifications.length;
      const totalRead = notifications.filter(n => n.read_at !== null).length;
      const totalUnread = totalSent - totalRead;
      const textParts = notificationEvent.text.split(': ');
      const title = textParts[0] || notificationEvent.text;
      const message = textParts.slice(1).join(': ') || '';

      return {
        success: true,
        data: {
          notification_event: {
            id: notificationEvent.id,
            title: title,
            message: message,
            type: notificationEvent.type,
            created_at: notificationEvent.created_at,
          },
          delivery_status: {
            total_sent: totalSent,
            total_read: totalRead,
            total_unread: totalUnread,
            read_rate: totalSent > 0 ? Number(((totalRead / totalSent) * 100).toFixed(2)) : 0,
          },
          recipients: notifications.map(n => ({
            notification_id: n.id,
            user_id: n.receiver_id,
            user_name: n.receiver?.name || 'N/A',
            user_email: n.receiver?.email || 'N/A',
            read: n.read_at !== null,
            read_at: n.read_at,
            created_at: n.created_at,
          })),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to check notification status',
      };
    }
  }

  async getUserNotifications(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }
      const notifications = await this.prisma.notification.findMany({
        where: {
          receiver_id: userId,
          deleted_at: null,
        },
        orderBy: {
          created_at: 'desc',
        },
        select: {
          id: true,
          notification_event: {
            select: {
              id: true,
              type: true,
              text: true,
              created_at: true,
            },
          },
          read_at: true,
          created_at: true,
          sender: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
        take: 50, 
      });
      const formattedNotifications = notifications.map(notification => {
        const textParts = notification.notification_event.text.split(': ');
        const title = textParts[0] || notification.notification_event.text;
        const message = textParts.slice(1).join(': ') || notification.notification_event.text;

        return {
          id: notification.id,
          title: title,
          message: message,
          type: notification.notification_event.type,
          read: notification.read_at !== null,
          read_at: notification.read_at,
          created_at: notification.created_at,
          sender: notification.sender,
        };
      });

      const unreadCount = formattedNotifications.filter(n => !n.read).length;

      return {
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
          total_notifications: formattedNotifications.length,
          unread_count: unreadCount,
          read_count: formattedNotifications.length - unreadCount,
          notifications: formattedNotifications,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to get user notifications',
      };
    }
  }

  async exportBookings(queryDto: QueryBookingListDto, res: Response) {
    try {
      const {
        search,
        status,
      } = queryDto;

      const andConditions: any[] = [
        { deleted_at: null },
      ];

      // Search by athlete name, coach name, or title
      if (search) {
        andConditions.push({
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { coach_profile: { user: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        });
      }

      // Filter by status
      if (status) {
        andConditions.push({ status: status });
      }

      const where_condition = andConditions.length > 1
        ? { AND: andConditions }
        : andConditions[0];

      const bookings = await this.prisma.booking.findMany({
        where: where_condition,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          coach_profile: {
            select: {
              id: true,
              primary_specialty: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      // Format data for export
      const exportData = bookings.map((booking) => ({
        'Athlete Name': booking.user?.name || 'N/A',
        'Session Type': booking.title || 'N/A',
        'Coach Name': booking.coach_profile?.user?.name || 'N/A',
        'Coach Specialization': booking.coach_profile?.primary_specialty || 'N/A',
        'Date & Time': booking.appointment_date 
          ? new Date(booking.appointment_date).toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })
          : 'N/A',
        'Status': booking.status,
        'Location': booking.location || 'N/A',
        'Duration (minutes)': booking.duration_minutes || 'N/A',
        'Created At': booking.created_at 
          ? new Date(booking.created_at).toLocaleString('en-US')
          : 'N/A',
      }));

      // Convert to CSV format
      if (exportData.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No bookings found to export',
        });
      }

      const headers = Object.keys(exportData[0] || {});
      const csvRows = [
        headers.join(','),
        ...exportData.map(row =>
          headers.map(header => {
            const value = row[header];
            // Escape commas and quotes in CSV
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          }).join(',')
        ),
      ];

      const csvContent = csvRows.join('\n');
      const fileName = `bookings_export_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(csvContent);
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to export bookings',
      });
    }
  }

  async findOne(id: string) {
    try {
      const booking = await this.prisma.booking.findFirst({
        where: {
          id: id,
          deleted_at: null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
          coach_profile: {
            select: {
              id: true,
              primary_specialty: true,
              specialties: true,
              certifications: true,
              experience_level: true,
              avg_rating: true,
              rating_count: true,
              is_verified: true,
              available_days: true,
              weekend_days: true,
              blocked_days: true,
              session_price: true,
              session_duration_minutes: true,
              hourly_currency: true,
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

      if (!booking) {
        return {
          success: false,
          message: 'Booking not found',
        };
      }
      const coachProfile = booking.coach_profile;
      const coach = coachProfile?.user;
      const specialties = coachProfile?.specialties || [];
      const specialtiesDisplay = specialties.length > 0 
        ? specialties.join(' ') 
        : coachProfile?.primary_specialty || '';
      
      const avgRating = coachProfile?.avg_rating 
        ? Number(coachProfile.avg_rating) 
        : null;
      const ratingCount = coachProfile?.rating_count || 0;
      const certifications = coachProfile?.certifications || [];
      const tags = [];
      if (coachProfile?.is_verified === 1) {
        tags.push('Certified');
      }
      if (coachProfile?.experience_level) {
        tags.push(coachProfile.experience_level);
      }
      const appointmentDate = booking.appointment_date 
        ? new Date(booking.appointment_date)
        : null;
      const formattedDate = appointmentDate
        ? appointmentDate.toLocaleDateString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
          })
        : null;
      const formattedTime = appointmentDate
        ? appointmentDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        : null;
      const sessionPrice = booking.session_price 
        ? Number(booking.session_price) 
        : coachProfile?.session_price 
          ? Number(coachProfile.session_price) 
          : 55;
      const currency = booking.currency || coachProfile?.hourly_currency || 'USD';
      const formattedPrice = `$${sessionPrice.toFixed(2)} per session`;
      const durationMinutes = booking.duration_minutes || coachProfile?.session_duration_minutes || 60;
      const formattedDuration = `${durationMinutes} minutes`;
      const responseData = {
        id: booking.id,
        title: booking.title || '1-on-1 Training Session',
        location: booking.location || 'Offline',
        duration: formattedDuration,
        duration_minutes: durationMinutes,
        date: formattedDate,
        time: formattedTime,
        date_time: formattedDate && formattedTime 
          ? `${formattedDate} • ${formattedTime}` 
          : null,
        appointment_date: booking.appointment_date,
        session_time: booking.session_time,
        price: formattedPrice,
        session_price: sessionPrice,
        currency: currency,
        description: booking.description || '',
        coach: {
          id: coach?.id,
          name: coach?.name || 'N/A',
          email: coach?.email,
          avatar: coach?.avatar,
          specialties: specialtiesDisplay,
          specialties_array: specialties,
          primary_specialty: coachProfile?.primary_specialty,
          rating: avgRating,
          rating_count: ratingCount,
          rating_display: avgRating && ratingCount 
            ? `${avgRating.toFixed(1)} (${ratingCount} reviews)` 
            : null,
          certifications: certifications,
          tags: tags,
          is_verified: coachProfile?.is_verified === 1,
          experience_level: coachProfile?.experience_level,
        },
        athlete: {
          id: booking.user?.id,
          name: booking.user?.name || 'N/A',
          email: booking.user?.email,
          avatar: booking.user?.avatar,
        },
        status: booking.status,
        notes: booking.notes,
        session_package_id: booking.session_package_id,
        google_map_link: booking.google_map_link,
        coach_availability: {
          available_days: coachProfile?.available_days || [],
          weekend_days: coachProfile?.weekend_days || [],
          blocked_days: coachProfile?.blocked_days || [],
        },
        created_at: booking.created_at,
        updated_at: booking.updated_at,
      };

      return {
        success: true,
        data: responseData,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to fetch booking',
      };
    }
  }

  async update(id: string, updateBookingListDto: UpdateBookingListDto) {
    try {
      const booking = await this.prisma.booking.findFirst({
        where: {
          id: id,
          deleted_at: null,
        },
      });

      if (!booking) {
        return {
          success: false,
          message: 'Booking not found',
        };
      }

      const updateData: any = {};

      if (updateBookingListDto.title !== undefined) {
        updateData.title = updateBookingListDto.title;
      }

      if (updateBookingListDto.status !== undefined) {
        updateData.status = updateBookingListDto.status;
      }

      if (updateBookingListDto.description !== undefined) {
        updateData.description = updateBookingListDto.description;
      }

      if (updateBookingListDto.notes !== undefined) {
        updateData.notes = updateBookingListDto.notes;
      }

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          message: 'No fields to update',
        };
      }

      updateData.updated_at = new Date();

      const updatedBooking = await this.prisma.booking.update({
        where: { id: id },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
          coach_profile: {
            select: {
              id: true,
              primary_specialty: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      return {
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to update booking',
      };
    }
  }

  async remove(id: string) {
    try {
      const booking = await this.prisma.booking.findFirst({
        where: {
          id: id,
        },
      });

      if (!booking) {
        return {
          success: false,
          message: 'Booking not found',
        };
      }

      await this.prisma.booking.update({
        where: { id: id },
        data: {
          deleted_at: new Date(),
        },
      });

      return {
        success: true,
        message: 'Booking deleted successfully',
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to delete booking',
      };
    }
  }
}
