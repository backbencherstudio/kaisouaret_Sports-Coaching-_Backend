import {
  Controller,
  Get,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  Post,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Get unread notifications
   */
  @Get('unread')
  async getUnreadNotifications(
    @GetUser('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = Math.min(parseInt(limit || '10'), 50);
    const offsetNum = parseInt(offset || '0');

    const notifications =
      await this.notificationsService.getUnreadNotifications(
        userId,
        limitNum,
        offsetNum,
      );

    return {
      success: true,
      data: notifications,
      count: notifications.length,
    };
  }

  /**
   * Get all notifications
   */
  @Get()
  async getAllNotifications(
    @GetUser('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = Math.min(parseInt(limit || '20'), 100);
    const offsetNum = parseInt(offset || '0');

    const notifications = await this.notificationsService.getAllNotifications(
      userId,
      limitNum,
      offsetNum,
    );

    return {
      success: true,
      data: notifications,
      count: notifications.length,
    };
  }

  /**
   * Mark notification as read
   */
  @Post(':id/read')
  async markAsRead(@Param('id') notificationId: string, @GetUser('userId') userId: string) {
    if (!notificationId) {
      throw new BadRequestException('Notification ID is required');
    }

    const notification =
      await this.notificationsService.markAsRead(notificationId, userId);

    return {
      success: true,
      data: notification,
    };
  }

  /**
   * Delete a notification
   */
  @Delete(':id')
  async deleteNotification(@Param('id') notificationId: string, @GetUser('userId') userId: string) {
    if (!notificationId) {
      throw new BadRequestException('Notification ID is required');
    }

    const notification =
      await this.notificationsService.deleteNotification(notificationId, userId);

    return {
      success: true,
      data: notification,
    };
  }

  /**
   * Clear all notifications
   */
  @Delete()
  async clearAllNotifications(@GetUser('userId') userId: string) {
    await this.notificationsService.clearAllNotifications(userId);

    return {
      success: true,
      message: 'All notifications cleared',
    };
  }
}
