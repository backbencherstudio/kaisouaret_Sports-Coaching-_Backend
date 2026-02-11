import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import appConfig from '../../../config/app.config';
import { CreateMessageDto } from './dto/create-message.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatRepository } from '../../../common/repository/chat/chat.repository';
import { SazedStorage } from '../../../common/lib/Disk/SazedStorage';
import { DateHelper } from '../../../common/helper/date.helper';
import { MessageGateway } from './message.gateway';
import { UserRepository } from '../../../common/repository/user/user.repository';
import { Role } from '../../../common/guard/role/role.enum';
import { BookingsService } from '../../bookings/bookings.service';
import { StripePayment } from '../../../common/lib/Payment/stripe/StripePayment';
import { NotificationRepository } from '../../../common/repository/notification/notification.repository';
import { BookingUpdateViaChatDto } from './dto/booking-update.dto';

@Injectable()
export class MessageService {
  constructor(
    private prisma: PrismaService,
    private readonly messageGateway: MessageGateway,
    private readonly bookingsService: BookingsService,
  ) {}

  async create(user_id: string, createMessageDto: CreateMessageDto) {
    try {
      const data: any = {};

      if (createMessageDto.conversation_id) {
        data.conversation_id = createMessageDto.conversation_id;
      }

      if (createMessageDto.receiver_id) {
        data.receiver_id = createMessageDto.receiver_id;
      }

      if (createMessageDto.message) {
        data.message = createMessageDto.message;
      }

      // check if conversation exists
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          id: data.conversation_id,
        },
      });

      if (!conversation) {
        return {
          success: false,
          message: 'Conversation not found',
        };
      }

      // check if receiver exists
      const receiver = await this.prisma.user.findFirst({
        where: {
          id: data.receiver_id,
        },
      });

      if (!receiver) {
        return {
          success: false,
          message: 'Receiver not found',
        };
      }

      const message = await this.prisma.message.create({
        data: {
          ...data,
          status: MessageStatus.SENT,
          sender_id: user_id,
        },
      });

      // update conversation updated_at
      await this.prisma.conversation.update({
        where: {
          id: data.conversation_id,
        },
        data: {
          updated_at: DateHelper.now(),
        },
      });

      const recipientSocketId = this.messageGateway.clients.get(
        data.receiver_id,
      );
      if (recipientSocketId) {
        this.messageGateway.server
          .to(recipientSocketId)
          .emit('message', { from: user_id, data: message });
      }

      return {
        success: true,
        data: message,
        message: 'Message sent successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findAll({
    user_id,
    conversation_id,
    limit = 20,
    cursor,
  }: {
    user_id: string;
    conversation_id: string;
    limit?: number;
    cursor?: string;
  }) {
    try {
      const userDetails = await UserRepository.getUserDetails(user_id);

      const where_condition = {
        AND: [{ id: conversation_id }],
      };

      if (userDetails.type != Role.ADMIN) {
        where_condition['OR'] = [
          { creator_id: user_id },
          { participant_id: user_id },
        ];
      }

      const conversation = await this.prisma.conversation.findFirst({
        where: {
          ...where_condition,
        },
      });

      if (!conversation) {
        return {
          success: false,
          message: 'Conversation not found',
        };
      }

      const paginationData = {};
      if (limit) {
        paginationData['take'] = limit;
      }
      if (cursor) {
        paginationData['cursor'] = cursor ? { id: cursor } : undefined;
      }

      const messages = await this.prisma.message.findMany({
        ...paginationData,
        where: {
          conversation_id: conversation_id,
        },
        orderBy: {
          created_at: 'asc',
        },
        select: {
          id: true,
          message: true,
          created_at: true,
          status: true,
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          receiver: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },

          attachment: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              file: true,
            },
          },
        },
      });

      // add attachment url
      for (const message of messages) {
        if (message.attachment) {
          message.attachment['file_url'] = SazedStorage.url(
            appConfig().storageUrl.attachment + message.attachment.file,
          );
        }
      }

      // add image url
      for (const message of messages) {
        if (message.sender && message.sender.avatar) {
          message.sender['avatar_url'] = SazedStorage.url(
            appConfig().storageUrl.avatar + message.sender.avatar,
          );
        }
        if (message.receiver && message.receiver.avatar) {
          message.receiver['avatar_url'] = SazedStorage.url(
            appConfig().storageUrl.avatar + message.receiver.avatar,
          );
        }
      }

      return {
        success: true,
        data: messages,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async updateMessageStatus(message_id: string, status: MessageStatus) {
    return await ChatRepository.updateMessageStatus(message_id, status);
  }

  async readMessage(message_id: string) {
    return await ChatRepository.updateMessageStatus(
      message_id,
      MessageStatus.READ,
    );
  }

  async updateUserStatus(user_id: string, status: string) {
    return await ChatRepository.updateUserStatus(user_id, status);
  }

  async sendCustomOffer(coachId: string, customOfferDto: any) {
    try {
      if (!coachId) throw new BadRequestException('Coach ID is required');
      if (!customOfferDto?.conversation_id)
        throw new BadRequestException('Conversation ID is required');

      const offerResult = await this.bookingsService.sendCustomOffer(
        coachId,
        customOfferDto.booking_id,
        customOfferDto,
      );

      const booking = await this.prisma.booking.findUnique({
        where: { id: customOfferDto.booking_id },
        select: { user_id: true },
      });
      if (!booking || !booking.user_id)
        throw new NotFoundException('Booking not found');

      const pricing = (offerResult?.data?.pricing || {}) as any;
      const offerTitle = offerResult?.data?.title || customOfferDto.title || 'Group Session';
      const memberCount = offerResult?.data?.number_of_members || customOfferDto.number_of_members || 1;
      const totalAmount = pricing?.total_amount ?? 0;
      const dueAmount = pricing?.due_amount ?? 0;

      const message = await this.prisma.message.create({
        data: {
          conversation_id: customOfferDto.conversation_id,
          sender_id: coachId,
          receiver_id: booking.user_id,
          message: `Custom offer sent: ${offerTitle} for ${memberCount} members. Total: $${totalAmount}. Due: $${dueAmount}.`,
          status: MessageStatus.SENT,
        },
      });

      await this.prisma.conversation.update({
        where: { id: customOfferDto.conversation_id },
        data: { updated_at: DateHelper.now() },
      });

      const recipientSocketId = this.messageGateway.clients.get(booking.user_id);
      if (recipientSocketId) {
        this.messageGateway.server
          .to(recipientSocketId)
          .emit('message', { from: coachId, data: message });
      }

      return {
        success: true,
        message: 'Custom offer sent successfully',
        data: offerResult?.data,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async acceptCustomOffer(
    athleteId: string,
    body: { booking_id: string; conversation_id: string },
  ) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!body?.booking_id) throw new BadRequestException('Booking ID is required');
    if (!body?.conversation_id)
      throw new BadRequestException('Conversation ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: body.booking_id, user_id: athleteId },
      select: { id: true, coach_id: true, currency: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    const offer = await this.prisma.customOffer.findFirst({
      where: {
        booking_id: booking.id,
        athlete_id: athleteId,
        status: 'PENDING',
      },
      orderBy: { created_at: 'desc' },
    });

    if (!offer) throw new BadRequestException('No pending custom offer found');

    const dueAmount =
      offer.due_amount !== null && offer.due_amount !== undefined
        ? Number(offer.due_amount)
        : 0;

    if (dueAmount <= 0) {
      await this.prisma.customOffer.update({
        where: { id: offer.id },
        data: {
          status: 'ACCEPTED',
          due_amount: 0,
          responded_at: new Date(),
        },
      });

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: {
          title: offer.title,
          appointment_date: offer.appointment_date,
          session_time: offer.session_time,
          session_time_display: offer.session_time_display,
          duration_minutes: offer.duration_minutes,
          number_of_members: offer.number_of_members,
          session_price: offer.session_price,
          total_amount: offer.total_amount,
          currency: offer.currency || booking.currency || 'USD',
        },
      });

      const message = await this.prisma.message.create({
        data: {
          conversation_id: body.conversation_id,
          sender_id: athleteId,
          receiver_id: booking.coach_id,
          message: 'Custom offer accepted. No payment required.',
          status: MessageStatus.SENT,
        },
      });

      await this.prisma.conversation.update({
        where: { id: body.conversation_id },
        data: { updated_at: DateHelper.now() },
      });

      const recipientSocketId = this.messageGateway.clients.get(booking.coach_id);
      if (recipientSocketId) {
        this.messageGateway.server
          .to(recipientSocketId)
          .emit('message', { from: athleteId, data: message });
      }

      await NotificationRepository.createNotification({
        receiver_id: booking.coach_id,
        sender_id: athleteId,
        text: 'Custom offer accepted (no payment required).',
        type: 'booking',
        entity_id: booking.id,
      });

      return {
        success: true,
        message: 'Custom offer accepted',
        data: { due_amount: 0, status: 'ACCEPTED' },
      };
    }

    const athlete = await this.prisma.user.findUnique({
      where: { id: athleteId },
      select: { id: true, name: true, email: true, billing_id: true },
    });
    if (!athlete) throw new NotFoundException('User not found');

    let customerId = athlete.billing_id;
    if (!customerId) {
      const stripeCustomer = await StripePayment.createCustomer({
        user_id: athlete.id,
        email: athlete.email || '',
        name: athlete.name || 'Athlete',
      });
      customerId = stripeCustomer.id;
      await this.prisma.user.update({
        where: { id: athlete.id },
        data: { billing_id: customerId },
      });
    }

    const currency = offer.currency || booking.currency || 'USD';
    const paymentIntent = await StripePayment.createPaymentIntent({
      amount: dueAmount,
      currency,
      customer_id: customerId,
      metadata: {
        booking_id: booking.id,
        user_id: athlete.id,
        custom_offer_id: offer.id,
        type: 'custom_offer',
      },
    });

    const tx = await this.prisma.paymentTransaction.create({
      data: {
        user_id: athlete.id,
        amount: dueAmount,
        currency,
        reference_number: paymentIntent.id,
        status: 'pending',
        type: 'custom_offer',
      },
    });

    await this.prisma.customOffer.update({
      where: { id: offer.id },
      data: {
        status: 'PAYMENT_PENDING',
        payment_transaction_id: tx.id,
        responded_at: new Date(),
        due_amount: dueAmount,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversation_id: body.conversation_id,
        sender_id: athleteId,
        receiver_id: booking.coach_id,
        message: `Custom offer accepted. Payment pending: $${dueAmount}.`,
        status: MessageStatus.SENT,
      },
    });

    await this.prisma.conversation.update({
      where: { id: body.conversation_id },
      data: { updated_at: DateHelper.now() },
    });

    const recipientSocketId = this.messageGateway.clients.get(booking.coach_id);
    if (recipientSocketId) {
      this.messageGateway.server
        .to(recipientSocketId)
        .emit('message', { from: athleteId, data: message });
    }

    await NotificationRepository.createNotification({
      receiver_id: booking.coach_id,
      sender_id: athleteId,
      text: `Custom offer accepted. Payment pending: $${dueAmount}.`,
      type: 'booking',
      entity_id: booking.id,
    });

    return {
      success: true,
      message: 'Custom offer accepted. Payment required',
      data: {
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        due_amount: dueAmount,
        status: 'PAYMENT_PENDING',
      },
    };
  }

  async declineCustomOffer(
    athleteId: string,
    body: { booking_id: string; conversation_id: string },
  ) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!body?.booking_id) throw new BadRequestException('Booking ID is required');
    if (!body?.conversation_id)
      throw new BadRequestException('Conversation ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: body.booking_id, user_id: athleteId },
      select: { id: true, coach_id: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    const offer = await this.prisma.customOffer.findFirst({
      where: {
        booking_id: booking.id,
        athlete_id: athleteId,
        status: 'PENDING',
      },
      orderBy: { created_at: 'desc' },
    });

    if (!offer) throw new BadRequestException('No pending custom offer found');

    await this.prisma.customOffer.update({
      where: { id: offer.id },
      data: {
        status: 'DECLINED',
        responded_at: new Date(),
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversation_id: body.conversation_id,
        sender_id: athleteId,
        receiver_id: booking.coach_id,
        message: 'Custom offer declined.',
        status: MessageStatus.SENT,
      },
    });

    await this.prisma.conversation.update({
      where: { id: body.conversation_id },
      data: { updated_at: DateHelper.now() },
    });

    const recipientSocketId = this.messageGateway.clients.get(booking.coach_id);
    if (recipientSocketId) {
      this.messageGateway.server
        .to(recipientSocketId)
        .emit('message', { from: athleteId, data: message });
    }

    await NotificationRepository.createNotification({
      receiver_id: booking.coach_id,
      sender_id: athleteId,
      text: 'Custom offer declined.',
      type: 'booking',
      entity_id: booking.id,
    });

    return {
      success: true,
      message: 'Custom offer declined',
      data: { status: 'DECLINED' },
    };
  }

  async updateBookingViaChat(
    coachId: string,
    body: BookingUpdateViaChatDto,
  ) {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!body?.booking_id) throw new BadRequestException('Booking ID is required');
    if (!body?.conversation_id)
      throw new BadRequestException('Conversation ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: body.booking_id },
      select: { id: true, user_id: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const { booking_id, conversation_id, ...updateDto } = body as any;
    const result = await this.bookingsService.updateBooking(
      coachId,
      booking_id,
      updateDto,
    );

    const changedFields = Object.keys(updateDto).filter(
      (key) => updateDto[key] !== undefined && updateDto[key] !== null,
    );
    const summary =
      changedFields.length > 0
        ? `Booking updated: ${changedFields.join(', ')}`
        : 'Booking updated.';

    const message = await this.prisma.message.create({
      data: {
        conversation_id,
        sender_id: coachId,
        receiver_id: booking.user_id,
        message: summary,
        status: MessageStatus.SENT,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation_id },
      data: { updated_at: DateHelper.now() },
    });

    const recipientSocketId = this.messageGateway.clients.get(booking.user_id);
    if (recipientSocketId) {
      this.messageGateway.server
        .to(recipientSocketId)
        .emit('message', { from: coachId, data: message });
    }

    return result;
  }
}
