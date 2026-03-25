import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import appConfig from '../../../config/app.config';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class NotificationGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit
{
  @WebSocketServer()
  server: Server;

  private redisPubClient: Redis;
  private redisSubClient: Redis;

  // Map to store connected clients
  private clients = new Map<string, string>(); // userId -> socketId

  constructor(private readonly notificationService: NotificationService) {}

  private getUserIdFromSocket(client: Socket): string | undefined {
    const userId = client.handshake.query.userId as string | undefined;
    if (!userId || typeof userId !== 'string') {
      return undefined;
    }
    return userId;
  }

  onModuleInit() {
    this.redisPubClient = new Redis({
      host: appConfig().redis.host,
      port: Number(appConfig().redis.port),
      password: appConfig().redis.password,
    });

    this.redisSubClient = new Redis({
      host: appConfig().redis.host,
      port: Number(appConfig().redis.port),
      password: appConfig().redis.password,
    });

    this.redisSubClient.subscribe('notification', (err, message: string) => {
      if (err) {
        console.error('Redis subscribe error:', err);
        return;
      }

      try {
        const data = JSON.parse(message);
        const targetUserId = data?.userId as string | undefined;
        if (!targetUserId) {
          return;
        }

        const targetSocketId = this.clients.get(targetUserId);
        if (targetSocketId) {
          this.server.to(targetSocketId).emit('receiveNotification', data);
        }
      } catch (parseError) {
        console.error('Failed to parse redis notification payload:', parseError);
      }
    });
  }

  afterInit(server: Server) {
    console.log('Websocket server started');
  }

  async handleConnection(client: Socket, ...args: any[]) {
    // console.log('new connection!', client.id);
    const userId = client.handshake.query.userId as string; // User ID passed as query parameter
    if (userId) {
      this.clients.set(userId, client.id);
      console.log(`User ${userId} connected with socket ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    // console.log('client disconnected!', client.id);
    const userId = [...this.clients.entries()].find(
      ([, socketId]) => socketId === client.id,
    )?.[0];
    if (userId) {
      this.clients.delete(userId);
      console.log(`User ${userId} disconnected`);
    }
  }

  // @SubscribeMessage('joinRoom')
  // handleRoomJoin(client: Socket, room: string) {
  //   client.join(room);
  //   client.emit('joinedRoom', room);
  // }

  @SubscribeMessage('sendNotification')
  async handleNotification(@MessageBody() data: any) {
    console.log(`Received notification: ${JSON.stringify(data)}`);
    // Broadcast notification to all clients
    // this.server.emit('receiveNotification', data);

    // Emit notification to specific client
    const targetSocketId = this.clients.get(data.userId);
    if (targetSocketId) {
      const isEnabled = await this.notificationService.isNotificationEnabled(
        data.userId,
      );

      if (!isEnabled) {
        return {
          success: true,
          skipped: true,
          reason: 'USER_NOTIFICATION_DISABLED',
          user_id: data.userId,
        };
      }

      await this.redisPubClient.publish('notification', JSON.stringify(data));

      // console.log(`Notification sent to user ${data.userId}`);
      return {
        success: true,
        skipped: false,
        user_id: data.userId,
      };
    } else {
      // console.log(`User ${data.userId} not connected`);
      return {
        success: true,
        skipped: true,
        reason: 'USER_OFFLINE',
        user_id: data.userId,
      };
    }
  }

  @SubscribeMessage('toggleNotification')
  async toggleNotification(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { userId: string; enabled: boolean },
  ) {
    const socketUserId = this.getUserIdFromSocket(client);
    if (!socketUserId) {
      return {
        success: false,
        message: 'Invalid socket user',
      };
    }

    if (typeof body.enabled !== 'boolean') {
      return {
        success: false,
        message: 'enabled(boolean) is required',
      };
    }

    if (body?.userId && body.userId !== socketUserId) {
      return {
        success: false,
        message: 'Unauthorized userId in payload',
      };
    }

    const result = await this.notificationService.setNotificationEnabled(
      socketUserId,
      body.enabled,
    );

    client.emit('notificationPreferenceUpdated', result);
    return result;
  }

  @SubscribeMessage('getNotificationPreference')
  async getNotificationPreference(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { userId: string },
  ) {
    const socketUserId = this.getUserIdFromSocket(client);
    if (!socketUserId) {
      return {
        success: false,
        message: 'Invalid socket user',
      };
    }

    if (body?.userId && body.userId !== socketUserId) {
      return {
        success: false,
        message: 'Unauthorized userId in payload',
      };
    }

    const result = await this.notificationService.getNotificationPreference(
      socketUserId,
    );

    client.emit('notificationPreference', result);
    return result;
  }

  @SubscribeMessage('createNotification')
  create(@MessageBody() createNotificationDto: CreateNotificationDto) {
    return this.notificationService.create(createNotificationDto);
  }

  @SubscribeMessage('findAllNotification')
  findAll() {
    return this.notificationService.findAll();
  }

  @SubscribeMessage('findOneNotification')
  findOne(@MessageBody() id: number) {
    return this.notificationService.findOne(id);
  }

  @SubscribeMessage('updateNotification')
  update(@MessageBody() updateNotificationDto: UpdateNotificationDto) {
    return this.notificationService.update(
      updateNotificationDto.id,
      updateNotificationDto,
    );
  }

  @SubscribeMessage('removeNotification')
  remove(@MessageBody() id: number) {
    return this.notificationService.remove(id);
  }
}
