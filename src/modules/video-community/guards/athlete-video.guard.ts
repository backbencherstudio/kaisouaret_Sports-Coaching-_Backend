import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AthleteVideoGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId) return false;

    const videoId = req.params?.id;
    if (!videoId) return true;

    const [userRecord, video] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { type: true },
      }),
      this.prisma.video.findUnique({
        where: { id: videoId },
        select: { is_premium: true },
      }),
    ]);

    if (!userRecord || !video) return true;
    if (userRecord.type === 'coach') return true;
    if (!video.is_premium) return true;

    const now = new Date();
    const activeAthleteSubscription = await this.prisma.userSubscription.findFirst({
      where: {
        user_id: user.userId,
        status: 'active',
        deleted_at: null,
        current_period_end: { gte: now },
        plan: { kind: 'ATHLETE' },
      },
      select: { id: true },
    });

    if (!activeAthleteSubscription) {
      throw new ForbiddenException('This video is for subscribed athletes only');
    }

    return true;
  }
}
