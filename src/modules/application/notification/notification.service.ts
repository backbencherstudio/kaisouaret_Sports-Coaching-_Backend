import { Injectable } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  private static readonly NOTIFICATION_SETTING_KEY =
    'notifications_enabled';

  constructor(private readonly prisma: PrismaService) {}

  create(createNotificationDto: CreateNotificationDto) {
    return 'This action adds a new notification';
  }

  findAll() {
    return `This action returns all notification`;
  }

  findOne(id: number) {
    return `This action returns a #${id} notification`;
  }

  update(id: number, updateNotificationDto: UpdateNotificationDto) {
    return `This action updates a #${id} notification`;
  }

  remove(id: number) {
    return `This action removes a #${id} notification`;
  }

  private async getOrCreateNotificationSettingId(): Promise<string> {
    const key = NotificationService.NOTIFICATION_SETTING_KEY;

    let setting = await this.prisma.setting.findUnique({
      where: { key },
      select: { id: true },
    });

    if (!setting) {
      setting = await this.prisma.setting.create({
        data: {
          category: 'notification',
          label: 'Notifications Enabled',
          description: 'Controls whether user receives realtime notifications',
          key,
          default_value: 'true',
        },
        select: { id: true },
      });
    }

    return setting.id;
  }

  async setNotificationEnabled(userId: string, enabled: boolean) {
    const settingId = await this.getOrCreateNotificationSettingId();

    const existing = await this.prisma.userSetting.findFirst({
      where: {
        user_id: userId,
        setting_id: settingId,
      },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.userSetting.update({
        where: { id: existing.id },
        data: {
          value: enabled ? 'true' : 'false',
        },
      });
    } else {
      await this.prisma.userSetting.create({
        data: {
          user_id: userId,
          setting_id: settingId,
          value: enabled ? 'true' : 'false',
        },
      });
    }

    return {
      success: true,
      user_id: userId,
      notification_enabled: enabled,
    };
  }

  async isNotificationEnabled(userId: string): Promise<boolean> {
    const settingId = await this.getOrCreateNotificationSettingId();

    const userSetting = await this.prisma.userSetting.findFirst({
      where: {
        user_id: userId,
        setting_id: settingId,
      },
      select: { value: true },
    });

    if (!userSetting || userSetting.value === null) {
      return true;
    }

    return userSetting.value.toLowerCase() !== 'false';
  }

  async getNotificationPreference(userId: string) {
    const enabled = await this.isNotificationEnabled(userId);
    return {
      success: true,
      user_id: userId,
      notification_enabled: enabled,
    };
  }

 
}
