import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CoachHomeService {
  constructor(private readonly prisma: PrismaService) {}

  private formatPercent(value: number | string | null | undefined) {
    if (value === null || value === undefined) return '0%';
    const n = Number(value);
    if (isNaN(n)) return '0%';
    // show up to 2 decimal places, remove trailing zeros
    const s = n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return `${s}%`;
  }

  // Overview metrics: total revenue, net profit, recurring revenue, avg revenue + trends
  async getOverview(coachId: string) {
    if (!coachId) return { error: 'Coach ID is required' };

    const coachProfile = await this.prisma.coachProfile.findUnique({
      where: { user_id: coachId },
    });
    if (!coachProfile) return { error: 'Coach profile not found' };

    const now = new Date();
    const start30 = new Date(now);
    start30.setDate(now.getDate() - 30);
    start30.setHours(0, 0, 0, 0);
    const prev30Start = new Date(now);
    prev30Start.setDate(now.getDate() - 60);
    prev30Start.setHours(0, 0, 0, 0);

    // fetch completed bookings for this coach (we'll reuse the set for multiple metrics)
    const completed = await this.prisma.booking.findMany({
      where: { coach_id: coachId, status: 'COMPLETED' },
      select: {
        id: true,
        user_id: true,
        session_price: true,
        total_amount: true,
        appointment_date: true,
        rating: true,
        created_at: true,
        updated_at: true,
      },
    });

    let totalRevenue = 0;
    let last30Revenue = 0;
    let prev30Revenue = 0;
    let totalSessions = 0;
    let last30Sessions = 0;
    let prev30Sessions = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    const userCompletedDates: Record<string, Date[]> = {};

    for (const b of completed) {
      const price = b.total_amount
        ? Number(b.total_amount as any)
        : b.session_price
        ? Number(b.session_price as any)
        : 0;
      totalRevenue += price;
      totalSessions += 1;
      const dt = new Date(b.appointment_date);
      if (dt >= start30 && dt <= now) {
        last30Revenue += price;
        last30Sessions += 1;
      }
      if (dt >= prev30Start && dt < start30) {
        prev30Revenue += price;
        prev30Sessions += 1;
      }
      if (typeof b.rating === 'number') {
        ratingSum += b.rating;
        ratingCount += 1;
      }
      if (b.user_id) {
        userCompletedDates[b.user_id] = userCompletedDates[b.user_id] || [];
        userCompletedDates[b.user_id].push(new Date(b.appointment_date));
      }
    }

    // revenue trend (last30 vs prev30)
    const revenueTrend =
      prev30Revenue === 0
        ? last30Revenue > 0
          ? 100
          : 0
        : +(((last30Revenue - prev30Revenue) / prev30Revenue) * 100).toFixed(2);

    // recurring revenue: sum of earnings from users with >1 completed booking in last 90 days
    const cutoffRecurring = new Date(now);
    cutoffRecurring.setDate(now.getDate() - 90);
    let recurringRevenue = 0;
    for (const [uid, dates] of Object.entries(userCompletedDates)) {
      const recentCount = dates.filter((d) => d >= cutoffRecurring).length;
      if (recentCount > 1) {
        for (const b of completed.filter((x) => x.user_id === uid)) {
          const price = b.total_amount
            ? Number(b.total_amount as any)
            : b.session_price
            ? Number(b.session_price as any)
            : 0;
          recurringRevenue += price;
        }
      }
    }

    // recurring trend (approx): last30 recurring vs prev30 recurring
    let last30Recurring = 0;
    let prev30Recurring = 0;
    for (const b of completed) {
      const dt = new Date(b.appointment_date);
      const price = b.total_amount
        ? Number(b.total_amount as any)
        : b.session_price
        ? Number(b.session_price as any)
        : 0;
      if (dt >= start30 && dt <= now) {
        if ((userCompletedDates[b.user_id] || []).length > 1) last30Recurring += price;
      }
      if (dt >= prev30Start && dt < start30) {
        if ((userCompletedDates[b.user_id] || []).length > 1) prev30Recurring += price;
      }
    }
    const recurringTrend =
      prev30Recurring === 0
        ? last30Recurring > 0
          ? 100
          : 0
        : +(((last30Recurring - prev30Recurring) / prev30Recurring) * 100).toFixed(2);

    const avgRevenue = totalSessions > 0 ? +(totalRevenue / totalSessions).toFixed(2) : 0;
    const avgLast30 = last30Sessions > 0 ? last30Revenue / last30Sessions : 0;
    const avgPrev30 = prev30Sessions > 0 ? prev30Revenue / prev30Sessions : 0;
    const avgRevenueTrend =
      avgPrev30 === 0 ? (avgLast30 > 0 ? 100 : 0) : +(((avgLast30 - avgPrev30) / avgPrev30) * 100).toFixed(2);

    // net profit — assume platform fee percent from env (default 25%)
    const feePercent = Number(process.env.PLATFORM_FEE_PERCENT ?? process.env.FEES_PERCENT ?? 0.25);
    const netProfit = +(totalRevenue * (1 - feePercent)).toFixed(2);
    const netProfitTrend = revenueTrend;

    const averageRating =
      ratingCount > 0 ? +(ratingSum / ratingCount).toFixed(2) : coachProfile.avg_rating ? Number(coachProfile.avg_rating) : null;

    return {
      totalRevenue,
      totalRevenueTrend: this.formatPercent(revenueTrend),
      netProfit,
      netProfitTrend: this.formatPercent(netProfitTrend),
      recurringRevenue,
      recurringRevenueTrend: this.formatPercent(recurringTrend),
      avgRevenue,
      avgRevenueTrend: this.formatPercent(avgRevenueTrend),
      totalSessions,
      averageRating,
    };
  }

  // Weekly sessions counts for the last 7 days (including today)
  async getWeeklySessions(coachId: string) {
    if (!coachId) return { error: 'Coach ID is required' };

    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 6); // last 7 days
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const bookings = await this.prisma.booking.findMany({
      where: {
        coach_id: coachId,
        appointment_date: { gte: start, lte: end },
      },
      select: { appointment_date: true },
      orderBy: { appointment_date: 'asc' },
    });

    // prepare buckets
    const buckets: { date: string; count: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      buckets.push({ date: iso, count: 0 });
    }

    for (const b of bookings) {
      const iso = new Date(b.appointment_date).toISOString().slice(0, 10);
      const bucket = buckets.find((x) => x.date === iso);
      if (bucket) bucket.count += 1;
    }

    return buckets;
  }

  // Top recurring customers (by completed bookings)
  async getTopCustomers(coachId: string, limit = 5) {
    if (!coachId) return { error: 'Coach ID is required' };

    const completed = await this.prisma.booking.findMany({
      where: { coach_id: coachId, status: 'COMPLETED' },
      select: { user_id: true },
    });

    const counts: Record<string, number> = {};
    for (const b of completed) counts[b.user_id] = (counts[b.user_id] || 0) + 1;

    const entries = Object.entries(counts)
      .map(([user_id, count]) => ({ user_id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    const userIds = entries.map((e) => e.user_id);
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              name: true,
              avatar: true,
              email: true,
              phone_number: true,
            },
          })
        : [];

    const userMap: Record<string, any> = {};
    for (const u of users) userMap[u.id] = u;

    return entries.map((e) => ({
      customer: userMap[e.user_id] || null,
      sessions: e.count,
    }));
  }

  // Performance metrics: retention, completion, rating and response time with trends
  async getPerformance(coachId: string) {
    if (!coachId) return { error: 'Coach ID is required' };

    const now = new Date();
    const start30 = new Date(now);
    start30.setDate(now.getDate() - 30);
    start30.setHours(0, 0, 0, 0);
    const prev30Start = new Date(now);
    prev30Start.setDate(now.getDate() - 60);
    prev30Start.setHours(0, 0, 0, 0);

    // total counts
    const totalBookings = await this.prisma.booking.count({ where: { coach_id: coachId } });
    const completedBookings = await this.prisma.booking.count({ where: { coach_id: coachId, status: 'COMPLETED' } });
    const completionRate = totalBookings > 0 ? +((completedBookings / totalBookings) * 100).toFixed(2) : 0;

    // fetch completed bookings in the 60-day window
    const completed = await this.prisma.booking.findMany({
      where: {
        coach_id: coachId,
        status: 'COMPLETED',
        appointment_date: { gte: prev30Start, lte: now },
      },
      select: { session_price: true, total_amount: true, appointment_date: true, rating: true, user_id: true },
    });

    let last30Earnings = 0;
    let prev30Earnings = 0;
    let last30Completed = 0;
    let prev30Completed = 0;
    let last30RatingSum = 0;
    let last30RatingCount = 0;
    let prev30RatingSum = 0;
    let prev30RatingCount = 0;

    for (const b of completed) {
      const dt = new Date(b.appointment_date);
      const price = b.total_amount ? Number(b.total_amount as any) : b.session_price ? Number(b.session_price as any) : 0;
      if (dt >= start30 && dt <= now) {
        last30Earnings += price;
        last30Completed += 1;
        if (typeof b.rating === 'number') {
          last30RatingSum += b.rating;
          last30RatingCount += 1;
        }
      } else if (dt >= prev30Start && dt < start30) {
        prev30Earnings += price;
        prev30Completed += 1;
        if (typeof b.rating === 'number') {
          prev30RatingSum += b.rating;
          prev30RatingCount += 1;
        }
      }
    }

    // client retention: users in last30 who also had completed bookings in prev30 divided by unique customers in prev30
    const usersLast30 = new Set(completed.filter((b) => new Date(b.appointment_date) >= start30 && new Date(b.appointment_date) <= now).map((b) => (b as any).user_id));
    const usersPrev30 = new Set(completed.filter((b) => new Date(b.appointment_date) >= prev30Start && new Date(b.appointment_date) < start30).map((b) => (b as any).user_id));
    const returning = Array.from(usersLast30).filter((u) => usersPrev30.has(u)).length;
    const clientRetentionRate = usersPrev30.size > 0 ? +((returning / usersPrev30.size) * 100).toFixed(2) : 0;

    // session completion rate for last 30 days (completed / total in that window). We approximate using counts
    const totalWindowBookings = last30Completed + prev30Completed;
    const sessionCompletionRate = totalWindowBookings > 0 ? +((last30Completed / totalWindowBookings) * 100).toFixed(2) : completionRate;

    const avgRatingLast30 = last30RatingCount > 0 ? +(last30RatingSum / last30RatingCount).toFixed(2) : null;
    const avgRatingPrev30 = prev30RatingCount > 0 ? +(prev30RatingSum / prev30RatingCount).toFixed(2) : null;
    const ratingTrend = avgRatingPrev30 === null ? (avgRatingLast30 !== null ? +((avgRatingLast30 - 0) * 100).toFixed(2) : 0) : avgRatingLast30 !== null ? +(((avgRatingLast30 - avgRatingPrev30) / avgRatingPrev30) * 100).toFixed(2) : 0;

    // response time: approximate using booking updated_at - created_at for bookings confirmed/completed in the 60-day window
    const bookingsForResponse = await this.prisma.booking.findMany({
      where: { coach_id: coachId, status: { in: ['CONFIRMED', 'COMPLETED'] }, updated_at: { gte: prev30Start, lte: now } },
      select: { created_at: true, updated_at: true },
    });
    let responseSumHours = 0;
    let responseCount = 0;
    let responseLast30 = 0;
    let responsePrev30 = 0;
    for (const b of bookingsForResponse) {
      const created = new Date(b.created_at).getTime();
      const updated = new Date(b.updated_at).getTime();
      if (!created || !updated || updated <= created) continue;
      const hours = (updated - created) / (1000 * 60 * 60);
      responseSumHours += hours;
      responseCount += 1;
      const dt = new Date(b.updated_at);
      if (dt >= start30 && dt <= now) responseLast30 += hours;
      if (dt >= prev30Start && dt < start30) responsePrev30 += hours;
    }
    const avgResponseHours = responseCount > 0 ? +(responseSumHours / responseCount).toFixed(2) : null;
    let responseTrend = 0;
    if (responsePrev30 > 0) responseTrend = +(((responseLast30 / (responsePrev30 || 1) - 1) * 100).toFixed(2));
    const responseStability = Math.abs(responseTrend) < 5 ? 'Stable' : responseTrend > 0 ? 'Slower' : 'Faster';

    return {
      clientRetentionRate,
      clientRetentionTrend: this.formatPercent(0),
      sessionCompletionRate,
      sessionCompletionTrend: this.formatPercent(0),
      averageSessionRating: avgRatingLast30 ?? avgRatingPrev30 ?? null,
      ratingTrend: this.formatPercent(ratingTrend),
      responseTimeHours: avgResponseHours,
      responseTimeTrendPercent: this.formatPercent(responseTrend),
      responseTimeStability: responseStability,
    };
  }
}
