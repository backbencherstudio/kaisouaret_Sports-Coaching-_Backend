import {
  Controller,
  Post,
  Body,
  UploadedFile,
  Req,
  UseGuards,
  Get,
  Query,
  Param,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MessageService } from './message.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageGateway } from './message.gateway';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GetUser } from 'src/modules/auth/decorators/get-user.decorator';
import { CustomOfferDto } from './dto/custom-offer.dto';
import { CustomOfferResponseDto } from './dto/custom-offer-response.dto';
import { BookingUpdateViaChatDto } from './dto/booking-update.dto';

@ApiBearerAuth()
@ApiTags('Message')
@UseGuards(JwtAuthGuard)
@Controller('chat/message')
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly messageGateway: MessageGateway,
  ) {}

  @ApiOperation({ summary: 'Send message with optional file attachment' })
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Req() req: Request,
    @Body() createMessageDto: CreateMessageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      createMessageDto.file = file;
    }

    const user_id = req.user.userId;
    const message = await this.messageService.create(user_id, createMessageDto);
    if (message.success) {
      this.messageGateway.server
        .to(message.data.conversation_id)
        .emit('message', {
          message_id: message.data.id,
          sender_id: message.data.sender_id,
          receiver_id: message.data.receiver_id,
          conversation_id: message.data.conversation_id,
          message: message.data.message,
          attachment_id: message.data.attachment_id || null,
          created_at: message.data.created_at,
          status: message.data.status,
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
  @Get('/:conversation_id/all')
  async getAllMessages(
    @Req() req: Request,
    @Param('conversation_id') conversation_id: string,
    @Query() query: { limit?: number; cursor?: string },
  ) {
    const user_id = req.user.userId;
    const limit = Number(query.limit);
    const cursor = query.cursor as string;

    console.log('conversation Id:', conversation_id);
    try {
      const messages = await this.messageService.getAllMessages({
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

  @ApiOperation({ summary: 'Accept a custom offer and pay remaining amount' })
  @Post('custom-offer/accept')
  async acceptCustomOffer(
    @GetUser('userId') athleteId: string,
    @Body() body: CustomOfferResponseDto,
  ) {
    return this.messageService.acceptCustomOffer(athleteId, body);
  }

  @ApiOperation({ summary: 'Decline a custom offer' })
  @Post('custom-offer/decline')
  async declineCustomOffer(
    @GetUser('userId') athleteId: string,
    @Body() body: CustomOfferResponseDto,
  ) {
    return this.messageService.declineCustomOffer(athleteId, body);
  }

  @ApiOperation({ summary: 'Update a booking via chat (coach only)' })
  @Post('booking/update')
  async updateBookingViaChat(
    @GetUser('userId') coachId: string,
    @Body() body: BookingUpdateViaChatDto,
  ) {
    return this.messageService.updateBookingViaChat(coachId, body);
  }
}
