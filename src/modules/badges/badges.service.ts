import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type ClaimResult = { awarded: boolean; userBadge?: any; reason?: string };

@Injectable()
export class BadgesService {
	constructor(private readonly prisma: PrismaService) {}

	// Return all badges. If userId provided, include earned info and earned_at.
	async getAllBadges(userId?: string) {
		const badges = await this.prisma.badge.findMany({ orderBy: { created_at: 'asc' } });

		if (!userId) return badges;

		const userBadges = await this.prisma.userBadge.findMany({ where: { user_id: userId } });
		const map: Record<string, any> = {};
		for (const ub of userBadges) map[ub.badge_id] = ub;

		return badges.map((b) => ({
			...b,
			earned: !!map[b.id],
			earned_at: map[b.id]?.earned_at ?? null,
		}));
	}

	// Return badges earned by a user and summary progress
	async getMyBadges(userId: string) {
		const [allBadges, userBadges] = await Promise.all([
			this.prisma.badge.findMany({ orderBy: { created_at: 'asc' } }),
			this.prisma.userBadge.findMany({ where: { user_id: userId }, include: { badge: true } }),
		]);

		const earnedMap: Record<string, any> = {};
		for (const ub of userBadges) earnedMap[ub.badge_id] = ub;

		const completedBookings = await this.prisma.booking.count({ where: { user_id: userId, status: 'COMPLETED' } });

		return {
			total: allBadges.length,
			earned_count: userBadges.length,
			completed_bookings: completedBookings,
			badges: allBadges.map((b) => ({ ...b, earned: !!earnedMap[b.id], earned_at: earnedMap[b.id]?.earned_at ?? null })),
		};
	}

	// Attempt to claim a badge for the user by badge key. Returns whether awarded.
	async claimBadge(userId: string, badgeKey: string): Promise<ClaimResult> {
		const badge = await this.prisma.badge.findUnique({ where: { key: badgeKey } });
		if (!badge) throw new NotFoundException('Badge not found');

		const already = await this.prisma.userBadge.findFirst({ where: { user_id: userId, badge_id: badge.id } });
		if (already) return { awarded: false, reason: 'Already awarded' };

		// Basic eligibility rules (approximate):
		const completedCount = await this.prisma.booking.count({ where: { user_id: userId, status: 'COMPLETED' } });

		const now = new Date();
		const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
		const completedLast7DaysRaw = await this.prisma.booking.findMany({ where: { user_id: userId, status: 'COMPLETED', appointment_date: { gte: sevenDaysAgo } }, select: { appointment_date: true } });
		const uniqueDays = new Set(completedLast7DaysRaw.map((r) => new Date(r.appointment_date).toDateString()));
		const completedLast7Days = uniqueDays.size;

		// evaluate per badge key
		let eligible = false;
		switch (badgeKey) {
			case 'first_session':
				eligible = completedCount >= 1;
				break;
			case 'goal_setter':
				// user must have goals set in user.goals
				const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { goals: true } });
				eligible = !!(user?.goals && user.goals.length > 0);
				break;
			case 'consistency_master':
				// 7 distinct days with completed sessions
				eligible = completedLast7Days >= 7;
				break;
			case 'marathon_trainer':
				eligible = completedCount >= 50;
				break;
			case 'perfect_week':
				// approximate: completed at least 7 sessions in last 7 days
				eligible = completedLast7Days >= 7;
				break;
			case 'legendary_athlete':
				// placeholder: require 1000 points — not tracked, allow admin/manual claim via ?
				eligible = false;
				break;
			default:
				// Unknown badge: only admin can award (not supported here)
				throw new BadRequestException('Unknown badge key');
		}

		if (!eligible) return { awarded: false, reason: 'Not eligible yet' };

		const userBadge = await this.prisma.userBadge.create({ data: { user_id: userId, badge_id: badge.id } });
		return { awarded: true, userBadge };
	}
}
