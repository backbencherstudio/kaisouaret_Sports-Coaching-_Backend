import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import dayjs = require('dayjs');
import { SazedStorage } from '../../../../common/lib/Disk/SazedStorage';
import appConfig from '../../../../config/app.config';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private formatTimeAgo(date: Date) {
    const now = Date.now();
    const diffMs = Math.max(now - new Date(date).getTime(), 0);
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  async overview() {
    const startOfMonth = dayjs().startOf('month').toDate();
    const endOfMonth = dayjs().endOf('month').toDate();

    const [totalUsers, activeUsers, totalSessions, monthlyRevenueTransactions] =
      await Promise.all([
        this.prisma.user.count({
          where: {
            deleted_at: null,
          },
        }),
        this.prisma.user.count({
          where: {
            deleted_at: null,
            status: 1,
          },
        }),
        this.prisma.booking.count({
          where: {
            deleted_at: null,
            status: {
              not: 'CANCELLED',
            },
          },
        }),
        this.prisma.paymentTransaction.findMany({
          where: {
            deleted_at: null,
            status: {
              in: ['succeeded', 'captured'],
            },
            created_at: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
          select: {
            paid_amount: true,
            amount: true,
          },
        }),
      ]);

    const monthlyRevenue = monthlyRevenueTransactions.reduce(
      (sum, transaction) => {
        const value = Number(transaction.paid_amount ?? transaction.amount ?? 0);
        return sum + (Number.isFinite(value) ? value : 0);
      },
      0,
    );

    return {
      success: true,
      totalUsers,
      activeUsers,
      totalSessions,
      monthlyRevenue,
    };
  }

  async getRevenueTrend({ months, year }: { months?: number; year?: number }) {
    const range =
      typeof months === 'number' && months >= 1 && months <= 24 ? months : 6;

    const hasYearFilter = typeof year === 'number';

    const startDate = hasYearFilter
      ? dayjs().year(year as number).startOf('year').toDate()
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

    const payments = await this.prisma.paymentTransaction.findMany({
      where: {
        deleted_at: null,
        status: {
          in: ['succeeded', 'captured'],
        },
        created_at: { gte: startDate, lte: endDate },
      },
      select: { created_at: true, paid_amount: true, amount: true },
      orderBy: { created_at: 'asc' },
    });

    const buckets = new Map<string, number>();
    for (const p of payments) {
      const key = dayjs(p.created_at).format('YYYY-MM');
      const amt = Number(p.paid_amount ?? p.amount ?? 0);
      buckets.set(key, (buckets.get(key) || 0) + (Number.isFinite(amt) ? amt : 0));
    }

    const trend: { month: string; revenue: number }[] = [];
    for (let i = 0; i < effectiveRange; i++) {
      const d = dayjs(startDate).add(i, 'month');
      const key = d.format('YYYY-MM');
      trend.push({ month: d.format('MMM'), revenue: buckets.get(key) || 0 });
    }

    return trend;
  }

  async getUserDistribution() {
    const activeBaseWhere = {
      deleted_at: null,
      status: 1,
    };

    const [coaches, athletes] = await Promise.all([
      this.prisma.user.count({
        where: {
          ...activeBaseWhere,
          type: 'coach',
        },
      }),
      this.prisma.user.count({
        where: {
          ...activeBaseWhere,
          type: 'user',
        },
      }),
    ]);

    const totalUsers = coaches + athletes;

    return {
      success: true,
      total: totalUsers,
      coaches,
      athletes,
    };
  }

  async getRecentActivity(limit = 10) {
    const items = await this.prisma.notification.findMany({
      where: {
        deleted_at: null,
        status: 1,
        notification_event: {
          is: {
            deleted_at: null,
            status: 1,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        created_at: true,
        notification_event: { select: { text: true, type: true } },
        sender: { select: { id: true, name: true, avatar: true } },
        receiver: { select: { id: true, name: true, avatar: true } },
      },
    });

    return items.map((n) => {
      const senderAvatarUrl = n.sender?.avatar
        ? SazedStorage.url(appConfig().storageUrl.avatar + n.sender.avatar)
        : null;
      const receiverAvatarUrl = n.receiver?.avatar
        ? SazedStorage.url(appConfig().storageUrl.avatar + n.receiver.avatar)
        : null;

      return {
        id: n.id,
        message: n.notification_event?.text ?? 'Notification',
        type: n.notification_event?.type ?? 'GENERAL',
        created_at: n.created_at,
        time_ago: this.formatTimeAgo(n.created_at),
        activity_date: dayjs(n.created_at).format('D, MMM, YY'),
        activity_meta: `${this.formatTimeAgo(n.created_at)} • ${dayjs(n.created_at).format('D, MMM, YY')}`,
        user_avatar_url: senderAvatarUrl ?? receiverAvatarUrl,
        sender: n.sender
          ? {
              id: n.sender.id,
              name: n.sender.name,
              avatar: n.sender.avatar,
              avatar_url: senderAvatarUrl,
            }
          : null,
        receiver: n.receiver
          ? {
              id: n.receiver.id,
              name: n.receiver.name,
              avatar: n.receiver.avatar,
              avatar_url: receiverAvatarUrl,
            }
          : null,
      };
    });
  }
}
