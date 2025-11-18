import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessageStatus } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import appConfig from '../../../config/app.config';
import { ChatRepository } from '../../../common/repository/chat/chat.repository';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MessageGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Map to store connected clients: userId -> socketId
  public clients = new Map<string, string>();

  onModuleInit() {}

  afterInit(server: Server) {
    console.log('Websocket server started');
  }

  // implement jwt token validation
  async handleConnection(client: Socket, ...args: any[]) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        console.log('No token provided');
        return;
      }

      const decoded: any = jwt.verify(token, appConfig().jwt.secret);
      const userId = decoded?.sub;
      if (!userId) {
        client.disconnect();
        console.log('Invalid token');
        return;
      }

      this.clients.set(userId, client.id);
      await ChatRepository.updateUserStatus(userId, 'online');
      this.server.emit('userStatusChange', {
        user_id: userId,
        status: 'online',
      });

      console.log(`User ${userId} connected`);
    } catch (error) {
      client.disconnect();
      console.error('Error handling connection:', error);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = [...this.clients.entries()].find(
      ([, socketId]) => socketId === client.id,
    )?.[0];
    if (userId) {
      this.clients.delete(userId);
      await ChatRepository.updateUserStatus(userId, 'offline');
      this.server.emit('userStatusChange', {
        user_id: userId,
        status: 'offline',
      });

      console.log(`User ${userId} disconnected`);
    }
  }

  @SubscribeMessage('joinRoom')
  handleRoomJoin(client: Socket, body: { room_id: string }) {
    const roomId = body.room_id;
    client.join(roomId);
    client.emit('joinedRoom', { room_id: roomId });
  }

  @SubscribeMessage('sendMessage')
  async listenForMessages(
    client: Socket,
    @MessageBody() body: { to: string; data: any },
  ) {
    const recipientSocketId = this.clients.get(body.to);
    const senderId = [...this.clients.entries()].find(([, socketId]) => socketId === client.id)?.[0];
    if (recipientSocketId) {
      this.server.to(recipientSocketId).emit('message', {
        from: senderId,
        data: body.data,
      });
    }
  }

  @SubscribeMessage('updateMessageStatus')
  async updateMessageStatus(
    client: Socket,
    @MessageBody() body: { message_id: string; status: MessageStatus },
  ) {
    await ChatRepository.updateMessageStatus(body.message_id, body.status);
    this.server.emit('messageStatusUpdated', {
      message_id: body.message_id,
      status: body.status,
    });
  }

  @SubscribeMessage('typing')
  handleTyping(client: Socket, @MessageBody() body: { to: string; data: any }) {
    const recipientSocketId = this.clients.get(body.to);
    const senderId = [...this.clients.entries()].find(([, socketId]) => socketId === client.id)?.[0];
    if (recipientSocketId) {
      this.server.to(recipientSocketId).emit('userTyping', {
        from: senderId,
        data: body.data,
      });
    }
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    client: Socket,
    @MessageBody() body: { to: string; data: any },
  ) {
    const recipientSocketId = this.clients.get(body.to);
    const senderId = [...this.clients.entries()].find(([, socketId]) => socketId === client.id)?.[0];
    if (recipientSocketId) {
      this.server.to(recipientSocketId).emit('userStoppedTyping', {
        from: senderId,
        data: body.data,
      });
    }
  }
}

