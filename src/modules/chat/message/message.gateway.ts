import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, forwardRef } from '@nestjs/common';
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
})
export class MessageGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
  ) {}

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
  handleRoomJoin(client: Socket, body: { conversation_id: string }) {
    const conversationId = body.conversation_id;
    client.join(conversationId);
    console.log(`Client joined room: ${conversationId}`);
    this.server.to(conversationId).emit('joinedRoom', { 
      conversation_id: conversationId,
      user_id: [...this.clients.entries()].find(
        ([, socketId]) => socketId === client.id,
      )?.[0],
    });
  }

  @SubscribeMessage('sendMessage')
  async listenForMessages(
    client: Socket,
    @MessageBody() body: { 
      receiver_id: string; 
      conversation_id: string; 
      message: string; 
      message_id?: string;
      attachment?: any;
    },
  ) {
    const senderId = [...this.clients.entries()].find(
      ([, socketId]) => socketId === client.id,
    )?.[0];

    if (!senderId) {
      client.emit('chatError', { message: 'Unauthorized socket client' });
      return;
    }
    
    console.log(`Message from ${senderId} to ${body.receiver_id}: ${body.message}`);

    const persisted = await this.messageService.create(senderId, {
      receiver_id: body.receiver_id,
      conversation_id: body.conversation_id,
      message: body.message,
    });

    if (!persisted?.success || !persisted?.data) {
      client.emit('chatError', {
        message: persisted?.message || 'Failed to store message',
      });
      return;
    }

    // Broadcast persisted payload to the entire conversation room.
    this.server.to(body.conversation_id).emit('message', {
      message_id: persisted.data.id,
      sender_id: persisted.data.sender_id,
      receiver_id: persisted.data.receiver_id,
      conversation_id: persisted.data.conversation_id,
      message: persisted.data.message,
      attachment: body.attachment || null,
      created_at: persisted.data.created_at,
      status: persisted.data.status,
    });
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
  handleTyping(client: Socket, @MessageBody() body: { conversation_id: string; sender_id: string }) {
    // Broadcast to all users in the conversation room
    this.server.to(body.conversation_id).emit('userTyping', {
      conversation_id: body.conversation_id,
      sender_id: body.sender_id,
    });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    client: Socket,
    @MessageBody() body: { conversation_id: string; sender_id: string },
  ) {
    // Broadcast to all users in the conversation room
    this.server.to(body.conversation_id).emit('userStoppedTyping', {
      conversation_id: body.conversation_id,
      sender_id: body.sender_id,
    });
  }
}