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
import { MessageStatus } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import appConfig from '../../../config/app.config';
import { ChatRepository } from '../../../common/repository/chat/chat.repository';
import { MessageService } from './message.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class MessageGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(private readonly messageService: MessageService) {}

  private getUserIdFromClient(client: Socket | undefined): string | undefined {
    if (!client) {
      return undefined;
    }

    const fromSocketData = (client.data as { userId?: string } | undefined)
      ?.userId;
    if (fromSocketData) {
      return fromSocketData;
    }

    return [...this.clients.entries()].find(([, socketId]) => socketId === client.id)?.[0];
  }

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
      const token =
        client.handshake.auth?.token ||
        client.handshake?.headers?.authorization?.split(' ')[1];

      if (!token) {
        client.disconnect();
        console.log('No token provided');
        throw new Error('No token provided');
      }

      const decoded: any = jwt.verify(token, appConfig().jwt.secret);
      const userId = decoded?.sub;
      
      if (!userId) {
        client.disconnect();
        console.log('Invalid token');
        throw new Error('Invalid token');
      }

      this.clients.set(userId, client.id);
      client.data = {
        ...(client.data || {}),
        userId,
      };
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
  handleRoomJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversation_id: string },
  ) {
    if (!client || !body?.conversation_id) {
      return { success: false, message: 'Invalid join room payload' };
    }

    const conversationId = body.conversation_id;
    const userId = this.getUserIdFromClient(client);
    client.join(conversationId);
    console.log(`Client joined room: ${conversationId}`);
    this.server.to(conversationId).emit('joinedRoom', { 
      conversation_id: conversationId,
      user_id: userId,
    });
  }

  @SubscribeMessage('sendMessage')
  async listenForMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { 
      receiver_id: string; 
      conversation_id: string; 
      message: string; 
      message_id?: string;
      attachment_id?: string;
      attachment?: any;
    },
  ) {
    if (!client) {
      return { success: false, message: 'Invalid socket client' };
    }

    const senderId = this.getUserIdFromClient(client);

    if (!senderId) {
      client?.emit?.('chatError', { message: 'Unauthorized socket client' });
      return { success: false, message: 'Unauthorized socket client' };
    }
    
    console.log(`Message from ${senderId} to ${body.receiver_id}: ${body.message}`);

    const persisted = await this.messageService.create(senderId, {
      receiver_id: body.receiver_id,
      conversation_id: body.conversation_id,
      message: body.message,
      attachment_id: body.attachment_id,
      attachment: body.attachment,
    });

    if (!persisted?.success || !persisted?.data) {
      client?.emit?.('chatError', {
        message: persisted?.message || 'Failed to store message',
      });
      return {
        success: false,
        message: persisted?.message || 'Failed to store message',
      };
    }

    // Broadcast persisted payload (including normalized attachment url) to the room.
    const realtimePayload = await this.messageService.getRealtimeMessagePayload(
      persisted.data.id,
    );

    this.server
      .to(body.conversation_id)
      .emit(
        'message',
        realtimePayload || {
          message_id: persisted.data.id,
          sender_id: persisted.data.sender_id,
          receiver_id: persisted.data.receiver_id,
          conversation_id: persisted.data.conversation_id,
          message: persisted.data.message,
          attachment_id: persisted.data.attachment_id || null,
          created_at: persisted.data.created_at,
          status: persisted.data.status,
        },
      );

    return {
      success: true,
      message: 'Message stored and delivered',
      data: {
        message_id: persisted.data.id,
      },
    };
  }

  @SubscribeMessage('updateMessageStatus')
  async updateMessageStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { message_id: string; status: MessageStatus },
  ) {
    await ChatRepository.updateMessageStatus(body.message_id, body.status);
    this.server.emit('messageStatusUpdated', {
      message_id: body.message_id,
      status: body.status,
    });
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversation_id: string; sender_id?: string },
  ) {
    const senderId =
      body.sender_id || this.getUserIdFromClient(client);

    // Broadcast to all users in the conversation room
    this.server.to(body.conversation_id).emit('userTyping', {
      conversation_id: body.conversation_id,
      sender_id: senderId,
    });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversation_id: string; sender_id?: string },
  ) {
    const senderId =
      body.sender_id || this.getUserIdFromClient(client);

    // Broadcast to all users in the conversation room
    this.server.to(body.conversation_id).emit('userStoppedTyping', {
      conversation_id: body.conversation_id,
      sender_id: senderId,
    });
  }
}