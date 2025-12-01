import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Get,
  Query,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageGateway } from './message.gateway';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GetUser } from 'src/modules/auth/decorators/get-user.decorator';
import { CustomOfferDto } from './dto/custom-offer.dto';

@ApiBearerAuth()
@ApiTags('Message')
@UseGuards(JwtAuthGuard)
@Controller('chat/message')
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly messageGateway: MessageGateway,
  ) {}

  @ApiOperation({ summary: 'Send message' })
  @Post()
  async create(
    @Req() req: Request,
    @Body() createMessageDto: CreateMessageDto,
  ) {
    const user_id = req.user.userId;
    const message = await this.messageService.create(user_id, createMessageDto);
    if (message.success) {
      const messageData = {
        message: {
          id: message.data.id,
          message_id: message.data.id,
          body_text: message.data.message,
          from: message.data.sender_id,
          conversation_id: message.data.conversation_id,
          created_at: message.data.created_at,
        },
      };
      this.messageGateway.server
        .to(message.data.conversation_id)
        .emit('message', {
          from: message.data.sender_id,
          data: messageData,
        });
      return {
        success: message.success,
        message: message.message,
      };
    } else {
      return {
        success: message.success,
        message: message.message,
      };
    }
  }

  @ApiOperation({ summary: 'Get all messages' })
  @Get()
  async findAll(
    @Req() req: Request,
    @Query()
    query: { conversation_id: string; limit?: number; cursor?: string },
  ) {
    const user_id = req.user.userId;
    const conversation_id = query.conversation_id as string;
    const limit = Number(query.limit);
    const cursor = query.cursor as string;
    try {
      const messages = await this.messageService.findAll({
        user_id,
        conversation_id,
        limit,
        cursor,
      });
      return messages;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({
    summary: 'Custom offer in the chat that will update the current booking',
  })
  @Post('custom-offer')
  async sendCustomOffer(
    @GetUser('userId') coachId: string,
    @Body() customOfferDto: CustomOfferDto,
  ) {
    return this.messageService.sendCustomOffer(coachId, customOfferDto);
  }
}
