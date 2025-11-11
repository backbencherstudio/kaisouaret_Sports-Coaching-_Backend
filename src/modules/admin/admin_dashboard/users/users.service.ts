import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import dayjs from 'dayjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  async overview(){
    const totalUsers = await this.prisma.user.count({
      where: {
        type: 'user',
      },
    });
    const activeUsers = await this.prisma.user.count({
      where: {
        type: 'user',
        deleted_at: null,
        status: 1,
      },
    });
    const totalSessions = await this.prisma.booking.count({
      where: {
        deleted_at: null,
        status: {
          not: 'CANCELLED',
        },
      },
    });
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthlyRevenueResult = await this.prisma.paymentTransaction.aggregate({
      where: {
        deleted_at: null,
        status: 'succeeded',
        created_at: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        paid_amount: true,
      },
    });

    const monthlyRevenue = monthlyRevenueResult._sum.paid_amount || 0;

    return {
      success: true,
      totalUsers,
      activeUsers,
      totalSessions,
      monthlyRevenue: Number(monthlyRevenue),
    };
  }

  async getRevenueTrend({ months, year }: { months?: number; year?: number }) {
    const valid = [3, 6, 12];
    const range = valid.includes(months ?? 0) ? (months as number) : 6;
  
    const y = year ?? dayjs().year();              // default: current year
    const startDate = dayjs().year(y).startOf('year').toDate();
    const endDate =
      range === 12
        ? dayjs(startDate).endOf('year').toDate()
        : dayjs(startDate).add(range - 1, 'month').endOf('month').toDate();
  
    const payments = await this.prisma.paymentTransaction.findMany({
      where: {
        deleted_at: null,
        status: 'succeeded',
        created_at: { gte: startDate, lte: endDate },
      },
      select: { created_at: true, paid_amount: true },
      orderBy: { created_at: 'asc' },
    });
  
    const buckets = new Map<string, number>();
    for (const p of payments) {
      const key = dayjs(p.created_at).format('YYYY-MMM');
      const amt = Number(p.paid_amount) || 0;
      buckets.set(key, (buckets.get(key) || 0) + amt);
    }
  
    const trend: { month: string; revenue: number }[] = [];
    for (let i = 0; i < range; i++) {
      const d = dayjs(startDate).add(i, 'month');
      const key = d.format('YYYY-MMM');
      trend.push({ month: d.format('MMM'), revenue: buckets.get(key) || 0 });
    }
  
    return trend;
  }

  async getUserDistribution() { 

    const coaches = await this.prisma.user.count({
      where: {
        deleted_at: null,
        status: 1,
        type: 'coach',
      },
    });

    const athletes = await this.prisma.user.count({
      where: {
        deleted_at: null,
        status: 1,
        type: 'user',
      },
    });
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
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 50), 
      select: {
        id: true,
        created_at: true,
        notification_event: { select: { text: true, type: true } },
        sender: { select: { id: true, name: true, avatar: true } },
        receiver: { select: { id: true, name: true } },
      },
    });
  
    return items.map((n) => ({
      id: n.id,
      message: n.notification_event?.text ?? '',
      type: n.notification_event?.type ?? null,
      created_at: n.created_at,
      sender: n.sender ? { id: n.sender.id, name: n.sender.name, avatar: n.sender.avatar } : null,
      receiver: n.receiver ? { id: n.receiver.id, name: n.receiver.name } : null,
    }));
  }
}
