import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface PaginateOpts {
	page?: number;
	limit?: number;
}

@Injectable()
export class ReviewsService {
	constructor(private readonly prisma: PrismaService) {}

	// Create a coach-level review (moved from bookings.service)
	async createReview(athleteId: string, bookingId: string, reviewDto: any) {
		if (!athleteId) return { error: 'Athlete ID is required' };
		if (!bookingId) return { error: 'Booking ID is required' };

		if (typeof reviewDto === 'string') reviewDto = { review: reviewDto };
		if (!reviewDto || !reviewDto.review)
			return { error: 'Review content is required' };

		const booking = await this.prisma.booking.findFirst({
			where: { id: bookingId, user_id: athleteId },
		});
		if (!booking) return { error: 'Booking not found' };

		if (booking.status !== 'COMPLETED')
			return { error: 'You can only review a completed booking' };

		const existing = await this.prisma.coachReview.findFirst({
			where: { booking_id: bookingId, athlete_id: athleteId },
		});
		if (existing) return { error: 'Review already submitted for this booking' };

		const coachReview = await this.prisma.coachReview.create({
			data: {
				coach_id: booking.coach_profile_id,
				athlete_id: athleteId,
				booking_id: bookingId,
				review_text: reviewDto.review,
				rating: reviewDto.rating || null,
			},
		});

		// Recompute aggregates (best-effort)
		try {
			const agg = await this.prisma.coachReview.aggregate({
				where: { coach_id: booking.coach_profile_id, rating: { not: null } },
				_avg: { rating: true },
				_count: { rating: true },
			});

			const avg = agg._avg?.rating ? Number(agg._avg.rating) : null;
			const count = agg._count?.rating ?? 0;

			await this.prisma.coachProfile.update({
				where: { id: booking.coach_profile_id },
				data: { avg_rating: avg, rating_count: count },
			});
		} catch (e) {
			console.error('Failed to update coach aggregates', e);
		}

		return coachReview;
	}

	// Public: get coach reviews with pagination
	async getCoachReviews(coachProfileId: string, opts: PaginateOpts = {}) {
		const page = Math.max(1, opts.page ?? 1);
		const limit = Math.min(100, opts.limit ?? 10);
		const skip = (page - 1) * limit;

		const coach = await this.prisma.coachProfile.findUnique({
			where: { id: coachProfileId },
			select: { id: true, avg_rating: true, rating_count: true },
		});
		if (!coach) throw new NotFoundException('Coach profile not found');

		const [reviews, count, aggregate] = await Promise.all([
			this.prisma.coachReview.findMany({
				where: { coach_id: coachProfileId },
				orderBy: { created_at: 'desc' },
				take: limit,
				skip,
				include: { athlete: { select: { id: true, name: true, avatar: true } } },
			}),
			this.prisma.coachReview.count({ where: { coach_id: coachProfileId } }),
			this.prisma.coachReview.aggregate({ where: { coach_id: coachProfileId, rating: { not: null } }, _avg: { rating: true } }),
		]);

		const computedAvg = aggregate?._avg?.rating != null ? Number(aggregate._avg.rating) : coach.avg_rating != null ? Number(coach.avg_rating) : 0;

		return {
			coach: { id: coach.id, avg_rating: computedAvg, rating_count: coach.rating_count ?? count },
			reviews: reviews.map((r) => ({ id: r.id, created_at: r.created_at, athlete: r.athlete || null, review: r.review_text ?? null, rating: r.rating ?? null })),
			page,
			limit,
			total: count,
		};
	}
}
