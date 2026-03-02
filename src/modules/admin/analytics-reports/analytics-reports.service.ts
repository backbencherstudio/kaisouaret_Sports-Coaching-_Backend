import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import dayjs = require('dayjs');

@Injectable()
export class AnalyticsReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get overview statistics for dashboard cards
   */
  async getOverview() {
    const now = new Date();
    const startOfMonth = dayjs().startOf('month').toDate();
    const endOfMonth = dayjs().endOf('month').toDate();
    const startOfLastMonth = dayjs().subtract(1, 'month').startOf('month').toDate();
    const endOfLastMonth = dayjs().subtract(1, 'month').endOf('month').toDate();

    const [
      currentMonthRevenue,
      lastMonthRevenue,
      currentMonthUsers,
      lastMonthUsers,
      totalSessions,
      completedSessions,
      canceledSessions,
    ] = await Promise.all([
      // Current month revenue
      this.prisma.paymentTransaction.findMany({
        where: {
          deleted_at: null,
          status: { in: ['succeeded', 'captured'] },
          created_at: { gte: startOfMonth, lte: endOfMonth },
        },
        select: { paid_amount: true, amount: true },
      }),
      // Last month revenue
      this.prisma.paymentTransaction.findMany({
        where: {
          deleted_at: null,
          status: { in: ['succeeded', 'captured'] },
          created_at: { gte: startOfLastMonth, lte: endOfLastMonth },
        },
        select: { paid_amount: true, amount: true },
      }),
      // Current month new users
      this.prisma.user.count({
        where: {
          deleted_at: null,
          created_at: { gte: startOfMonth, lte: endOfMonth },
        },
      }),
      // Last month new users
      this.prisma.user.count({
        where: {
          deleted_at: null,
          created_at: { gte: startOfLastMonth, lte: endOfLastMonth },
        },
      }),
      // Total sessions
      this.prisma.booking.count({
        where: { deleted_at: null },
      }),
      // Completed sessions
      this.prisma.booking.count({
        where: { deleted_at: null, status: 'COMPLETED' },
      }),
      // Canceled sessions
      this.prisma.booking.count({
        where: { deleted_at: null, status: 'CANCELLED' },
      }),
    ]);

    const currentRevenue = currentMonthRevenue.reduce(
      (sum, tx) => sum + Number(tx.paid_amount ?? tx.amount ?? 0),
      0,
    );
    const lastRevenue = lastMonthRevenue.reduce(
      (sum, tx) => sum + Number(tx.paid_amount ?? tx.amount ?? 0),
      0,
    );

    return {
      success: true,
      data: {
        totalRevenue: Math.round(currentRevenue),
        userGrowth: currentMonthUsers,
        userGrowthChange: currentMonthUsers - lastMonthUsers,
        sessionVolume: totalSessions,
        completed: completedSessions,
        canceled: canceledSessions,
      },
    };
  }

  /**
   * Get revenue analytics over time
   */
  async getRevenueAnalytics({
    months = 6,
    year,
  }: {
    months?: number;
    year?: number;
  }) {
    const range = months >= 1 && months <= 24 ? months : 6;
    const hasYearFilter = typeof year === 'number';

    const startDate = hasYearFilter
      ? dayjs().year(year).startOf('year').toDate()
      : dayjs().subtract(range - 1, 'month').startOf('month').toDate();

    const rawEndDate = hasYearFilter
      ? dayjs(startDate).add(range - 1, 'month').endOf('month').toDate()
      : dayjs().endOf('month').toDate();

    const endDate = hasYearFilter
      ? dayjs(rawEndDate).isAfter(dayjs(startDate).endOf('year'))
        ? dayjs(startDate).endOf('year').toDate()
        : rawEndDate
      : rawEndDate;

    const effectiveRange = dayjs(endDate).diff(dayjs(startDate), 'month') + 1;

    const transactions = await this.prisma.paymentTransaction.findMany({
      where: {
        deleted_at: null,
        status: { in: ['succeeded', 'captured'] },
        created_at: { gte: startDate, lte: endDate },
      },
      select: { created_at: true, paid_amount: true, amount: true },
      orderBy: { created_at: 'asc' },
    });

    const buckets = new Map<string, number>();
    for (const tx of transactions) {
      const key = dayjs(tx.created_at).format('YYYY-MM');
      const amt = Number(tx.paid_amount ?? tx.amount ?? 0);
      buckets.set(key, (buckets.get(key) || 0) + amt);
    }

    const chartData: { month: string; revenue: number; label: string }[] = [];
    for (let i = 0; i < effectiveRange; i++) {
      const d = dayjs(startDate).add(i, 'month');
      const key = d.format('YYYY-MM');
      chartData.push({
        month: key,
        label: d.format('MMM'),
        revenue: Math.round(buckets.get(key) || 0),
      });
    }

    return {
      success: true,
      data: chartData,
    };
  }

  /**
   * Get session types breakdown
   */
  async getSessionTypes() {
    const bookings = await this.prisma.booking.findMany({
      where: {
        deleted_at: null,
        status: { not: 'CANCELLED' },
      },
      include: {
        coach_profile: {
          select: {
            primary_specialty: true,
            specialties: true,
          },
        },
      },
    });

    const typeCounts = new Map<string, number>();

    for (const booking of bookings) {
      const specialty =
        booking.coach_profile?.primary_specialty ||
        booking.coach_profile?.specialties?.[0] ||
        'General';
      typeCounts.set(specialty, (typeCounts.get(specialty) || 0) + 1);
    }

    const data = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return {
      success: true,
      data,
    };
  }

  /**
   * Generate User Activity Report
   */
  async generateUserActivityReport(period: 'week' | 'month' | 'year' = 'month') {
    const startDate = this.getStartDate(period);

    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        created_at: { gte: startDate },
      },
      select: {
        id: true,
        name: true,
        email: true,
        type: true,
        created_at: true,
        status: true,
        _count: {
          select: {
            bookings: true,
            sender_notifications: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const reportData = users.map((u) => ({
      id: u.id,
      name: u.name || 'N/A',
      email: u.email || 'N/A',
      type: u.type || 'user',
      status: u.status === 1 ? 'Active' : 'Inactive',
      total_bookings: u._count.bookings,
      total_notifications: u._count.sender_notifications,
      joined_date: dayjs(u.created_at).format('YYYY-MM-DD'),
    }));

    return {
      success: true,
      report_name: 'User Activity Report',
      period,
      generated_at: new Date().toISOString(),
      total_records: reportData.length,
      data: reportData,
    };
  }

  /**
   * Generate Revenue Report
   */
  async generateRevenueReport(period: 'week' | 'month' | 'year' = 'month') {
    const startDate = this.getStartDate(period);

    const transactions = await this.prisma.paymentTransaction.findMany({
      where: {
        deleted_at: null,
        status: { in: ['succeeded', 'captured'] },
        created_at: { gte: startDate },
      },
      select: {
        id: true,
        type: true,
        amount: true,
        paid_amount: true,
        currency: true,
        status: true,
        created_at: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const reportData = transactions.map((tx) => ({
      transaction_id: tx.id,
      type: tx.type || 'N/A',
      amount: Number(tx.paid_amount ?? tx.amount ?? 0),
      currency: tx.currency || 'USD',
      status: tx.status,
      user_name: tx.user?.name || 'N/A',
      user_email: tx.user?.email || 'N/A',
      date: dayjs(tx.created_at).format('YYYY-MM-DD HH:mm'),
    }));

    const totalRevenue = reportData.reduce((sum, r) => sum + r.amount, 0);

    return {
      success: true,
      report_name: 'Revenue Report',
      period,
      generated_at: new Date().toISOString(),
      total_records: reportData.length,
      total_revenue: Math.round(totalRevenue),
      data: reportData,
    };
  }

  /**
   * Generate Session Statistics Report
   */
  async generateSessionStatistics(period: 'week' | 'month' | 'year' = 'month') {
    const startDate = this.getStartDate(period);

    const bookings = await this.prisma.booking.findMany({
      where: {
        deleted_at: null,
        created_at: { gte: startDate },
      },
      select: {
        id: true,
        title: true,
        status: true,
        appointment_date: true,
        duration_minutes: true,
        session_price: true,
        currency: true,
        created_at: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        coach_profile: {
          select: {
            user: {
              select: {
                name: true,
              },
            },
            primary_specialty: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const reportData = bookings.map((b) => ({
      booking_id: b.id,
      title: b.title || 'N/A',
      status: b.status,
      athlete: b.user?.name || 'N/A',
      coach: b.coach_profile?.user?.name || 'N/A',
      specialty: b.coach_profile?.primary_specialty || 'N/A',
      duration: b.duration_minutes || 0,
      price: Number(b.session_price ?? 0),
      currency: b.currency || 'USD',
      appointment_date: dayjs(b.appointment_date).format('YYYY-MM-DD'),
      booked_date: dayjs(b.created_at).format('YYYY-MM-DD'),
    }));

    const statusBreakdown = {
      total: bookings.length,
      pending: bookings.filter((b) => b.status === 'PENDING').length,
      confirmed: bookings.filter((b) => b.status === 'CONFIRMED').length,
      completed: bookings.filter((b) => b.status === 'COMPLETED').length,
      cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
    };

    return {
      success: true,
      report_name: 'Session Statistics',
      period,
      generated_at: new Date().toISOString(),
      total_records: reportData.length,
      status_breakdown: statusBreakdown,
      data: reportData,
    };
  }

  /**
   * Generate Coach Performance Report
   */
  async generateCoachPerformanceReport(
    period: 'week' | 'month' | 'year' = 'month',
  ) {
    const startDate = this.getStartDate(period);

    const coaches = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        type: 'coach',
        coach_profile: {
          is: {
            status: 1,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        coach_profile: {
          select: {
            primary_specialty: true,
            avg_rating: true,
            rating_count: true,
            hourly_rate: true,
            _count: {
              select: {
                bookings: true,
              },
            },
            bookings: {
              where: {
                deleted_at: null,
                created_at: { gte: startDate },
                status: { in: ['CONFIRMED', 'COMPLETED'] },
              },
              select: {
                session_price: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const reportData = coaches.map((coach) => {
      const sessionsInPeriod = coach.coach_profile?.bookings.length || 0;
      const completedInPeriod =
        coach.coach_profile?.bookings.filter((b) => b.status === 'COMPLETED')
          .length || 0;
      const revenueInPeriod =
        coach.coach_profile?.bookings.reduce(
          (sum, b) => sum + Number(b.session_price ?? 0),
          0,
        ) || 0;

      return {
        coach_id: coach.id,
        name: coach.name || 'N/A',
        email: coach.email || 'N/A',
        specialty: coach.coach_profile?.primary_specialty || 'N/A',
        avg_rating: Number(coach.coach_profile?.avg_rating ?? 0).toFixed(1),
        total_ratings: coach.coach_profile?.rating_count || 0,
        hourly_rate: Number(coach.coach_profile?.hourly_rate ?? 0),
        total_bookings: coach.coach_profile?._count.bookings || 0,
        sessions_in_period: sessionsInPeriod,
        completed_in_period: completedInPeriod,
        revenue_in_period: Math.round(revenueInPeriod),
      };
    });

    return {
      success: true,
      report_name: 'Coach Performance Report',
      period,
      generated_at: new Date().toISOString(),
      total_coaches: reportData.length,
      data: reportData,
    };
  }

  /**
   * Generate Analytics Report (comprehensive overview)
   */
  async generateAnalyticsReport(period: 'week' | 'month' | 'year' = 'month') {
    const startDate = this.getStartDate(period);
    const endDate = new Date();

    const [
      totalUsers,
      newUsers,
      totalCoaches,
      activeCoaches,
      totalBookings,
      completedBookings,
      totalRevenue,
      avgSessionPrice,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deleted_at: null } }),
      this.prisma.user.count({
        where: { deleted_at: null, created_at: { gte: startDate } },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, type: 'coach' },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, type: 'coach', status: 1 },
      }),
      this.prisma.booking.count({
        where: { deleted_at: null, created_at: { gte: startDate } },
      }),
      this.prisma.booking.count({
        where: {
          deleted_at: null,
          created_at: { gte: startDate },
          status: 'COMPLETED',
        },
      }),
      this.prisma.paymentTransaction
        .findMany({
          where: {
            deleted_at: null,
            status: { in: ['succeeded', 'captured'] },
            created_at: { gte: startDate },
          },
          select: { paid_amount: true, amount: true },
        })
        .then((txs) =>
          txs.reduce((sum, tx) => sum + Number(tx.paid_amount ?? tx.amount ?? 0), 0),
        ),
      this.prisma.booking
        .aggregate({
          where: {
            deleted_at: null,
            created_at: { gte: startDate },
            status: { not: 'CANCELLED' },
          },
          _avg: { session_price: true },
        })
        .then((result) => Number(result._avg.session_price ?? 0)),
    ]);

    return {
      success: true,
      report_name: 'Analytics Report',
      period,
      date_range: {
        start: dayjs(startDate).format('YYYY-MM-DD'),
        end: dayjs(endDate).format('YYYY-MM-DD'),
      },
      generated_at: new Date().toISOString(),
      summary: {
        users: {
          total: totalUsers,
          new_in_period: newUsers,
        },
        coaches: {
          total: totalCoaches,
          active: activeCoaches,
        },
        bookings: {
          total_in_period: totalBookings,
          completed: completedBookings,
          completion_rate:
            totalBookings > 0
              ? ((completedBookings / totalBookings) * 100).toFixed(1) + '%'
              : '0%',
        },
        revenue: {
          total: Math.round(totalRevenue),
          avg_session_price: Math.round(avgSessionPrice),
        },
      },
    };
  }

  /**
   * Helper: Get start date based on period
   */
  private getStartDate(period: 'week' | 'month' | 'year'): Date {
    switch (period) {
      case 'week':
        return dayjs().subtract(7, 'day').toDate();
      case 'month':
        return dayjs().subtract(1, 'month').toDate();
      case 'year':
        return dayjs().subtract(1, 'year').toDate();
      default:
        return dayjs().subtract(1, 'month').toDate();
    }
  }
}
