import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
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
import {
  NotificationsService,
  NotificationType,
} from '../../notifications/notifications.service';
import { BookingUpdateViaChatDto } from './dto/booking-update.dto';

@Injectable()
export class MessageService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => MessageGateway))
    private readonly messageGateway: MessageGateway,
    private readonly bookingsService: BookingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private normalizeStoredFilePath(
    uploadResult: any,
    fallbackKey: string,
  ): string {
    if (!uploadResult) {
      return fallbackKey;
    }

    if (typeof uploadResult === 'string') {
      return uploadResult;
    }

    // AWS/MinIO upload response shape
    if (uploadResult.key && typeof uploadResult.key === 'string') {
      return uploadResult.key;
    }

    if (uploadResult.Key && typeof uploadResult.Key === 'string') {
      return uploadResult.Key;
    }

    if (uploadResult.Location && typeof uploadResult.Location === 'string') {
      try {
        const parsed = new URL(uploadResult.Location);
        const pathWithoutPrefix = parsed.pathname.replace(/^\/+/, '');
        const bucket = uploadResult.Bucket
          ? String(uploadResult.Bucket).replace(/^\/+|\/+$/g, '')
          : '';

        if (bucket && pathWithoutPrefix.startsWith(`${bucket}/`)) {
          return pathWithoutPrefix.substring(bucket.length + 1);
        }

        return pathWithoutPrefix || fallbackKey;
      } catch {
        return uploadResult.Location;
      }
    }

    return fallbackKey;
  }

  private buildAttachmentFileUrl(storedFileRaw: string): string {
    const storedFile = String(storedFileRaw || '');
    const isAbsoluteUrl = /^https?:\/\//i.test(storedFile);
    if (isAbsoluteUrl) {
      return storedFile;
    }

    const attachmentPrefix = appConfig().storageUrl.attachment;
    const normalizedKey =
      storedFile.startsWith(`${attachmentPrefix}/`) ||
      storedFile === attachmentPrefix
        ? storedFile
        : `${attachmentPrefix}/${storedFile}`;

    return SazedStorage.url(normalizedKey);
  }

  async getRealtimeMessagePayload(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        sender_id: true,
        receiver_id: true,
        conversation_id: true,
        message: true,
        attachment_id: true,
        created_at: true,
        status: true,
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

    if (!message) {
      return null;
    }

    const attachment = message.attachment
      ? {
          ...message.attachment,
          file_url: this.buildAttachmentFileUrl(
            String(message.attachment.file || ''),
          ),
        }
      : null;

    return {
      message_id: message.id,
      sender_id: message.sender_id,
      receiver_id: message.receiver_id,
      conversation_id: message.conversation_id,
      message: message.message,
      attachment_id: message.attachment_id || null,
      attachment,
      created_at: message.created_at,
      status: message.status,
    };
  }

  private emitConversationMessage(
    conversationId: string,
    message: {
      id: string;
      sender_id: string | null;
      receiver_id: string | null;
      conversation_id: string | null;
      booking_id?: string | null;
      message: string | null;
      status: MessageStatus | null;
      created_at: Date;
      attachment_id?: string | null;
    },
    extras?: Record<string, any>,
  ) {
    this.messageGateway.server.to(conversationId).emit('message', {
      message_id: message.id,
      sender_id: message.sender_id,
      receiver_id: message.receiver_id,
      conversation_id: message.conversation_id,
      booking_id: message.booking_id || null,
      message: message.message,
      attachment_id: message.attachment_id || null,
      created_at: message.created_at,
      status: message.status,
      ...(extras || {}),
    });
  }

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

      // Reuse existing uploaded attachment if provided.
      if (createMessageDto.attachment_id) {
        const existingAttachment = await this.prisma.attachment.findUnique({
          where: { id: createMessageDto.attachment_id },
          select: { id: true },
        });
        if (!existingAttachment) {
          throw new NotFoundException('Attachment not found');
        }
        data.attachment_id = existingAttachment.id;
      }

      // check if conversation exists
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          id: data.conversation_id,
        },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      // check if receiver exists
      const receiver = await this.prisma.user.findFirst({
        where: {
          id: data.receiver_id,
        },
      });

      if (!receiver) {
        throw new NotFoundException('Receiver not found');
      }

      // Handle file upload
      if (!data.attachment_id && createMessageDto.file) {
        try {
          const fileName = `message_${Date.now()}_${createMessageDto.file.originalname}`;
          const filePath = `${appConfig().storageUrl.attachment}/${fileName}`;
          const uploadResult = await SazedStorage.put(
            filePath,
            createMessageDto.file.buffer,
          );
          const storedFilePath = this.normalizeStoredFilePath(
            uploadResult,
            filePath,
          );

          // Detect media format based on MIME type
          const mimeType = createMessageDto.file.mimetype;
          let format = 'document'; // default
          if (mimeType.startsWith('image/')) {
            format = 'image';
          } else if (mimeType.startsWith('video/')) {
            format = 'video';
          } else if (mimeType.startsWith('audio/')) {
            format = 'audio';
          }

          const attachmentData: any = {
            name: createMessageDto.file.originalname,
            type: mimeType,
            size: createMessageDto.file.size,
            file: storedFilePath,
            file_alt: createMessageDto.file.originalname,
            format: format,
          };

          const attachment = await this.prisma.attachment.create({
            data: attachmentData,
          });

          data.attachment_id = attachment.id;
        } catch (error) {
          console.error('Error uploading file:', error);
          // Continue with message creation even if file upload fails
        }
      }

      // Handle direct attachment metadata for socket/direct sends.
      if (
        !data.attachment_id &&
        createMessageDto.attachment &&
        createMessageDto.attachment.file
      ) {
        const a = createMessageDto.attachment;
        const attachment = await this.prisma.attachment.create({
          data: {
            name: a.name,
            type: a.type,
            size: a.size,
            file: a.file,
            file_alt: a.file_alt || a.name,
            format: a.format,
          },
        });
        data.attachment_id = attachment.id;
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

  async getAllMessages({
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
        throw new NotFoundException('Conversation not found');
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
          created_at: 'desc',
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
          message.attachment['file_url'] = this.buildAttachmentFileUrl(
            String(message.attachment.file || ''),
          );
        }
      }

      // Fetch custom offers for messages that contain custom offer data
      const messagesWithOffers = await Promise.all(
        messages.map(async (msg: any) => {
          if (msg.message && msg.message.includes('Custom offer sent:')) {
            // Find the custom offer sent by this sender around this time
            const offer = await this.prisma.customOffer.findFirst({
              where: {
                coach_id: msg.sender.id,
                athlete_id: msg.receiver.id,
                created_at: {
                  gte: new Date(new Date(msg.created_at).getTime() - 5000), // within 5 seconds before message
                  lte: new Date(new Date(msg.created_at).getTime() + 5000),
                },
              },
            });

            if (offer) {
              return {
                ...msg,
                custom_offer: {
                  id: offer.id,
                  booking_id: offer.booking_id,
                  title: offer.title,
                  appointment_date: offer.appointment_date,
                  session_time: offer.session_time,
                  session_time_display: offer.session_time_display,
                  duration_minutes: offer.duration_minutes,
                  number_of_members: offer.number_of_members,
                  pricing: {
                    base_price_per_session: offer.session_price
                      ? Number(offer.session_price)
                      : 0,
                    paid_amount: offer.paid_amount
                      ? Number(offer.paid_amount)
                      : 0,
                    due_amount: offer.due_amount ? Number(offer.due_amount) : 0,
                    total_amount: offer.total_amount
                      ? Number(offer.total_amount)
                      : 0,
                    currency: offer.currency || 'USD',
                  },
                  status: offer.status,
                },
              };
            }
          }
          return msg;
        }),
      );

      return {
        success: true,
        data: messagesWithOffers,
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
      const offerTitle =
        offerResult?.data?.title || customOfferDto.title || 'Group Session';
      const memberCount =
        offerResult?.data?.number_of_members ||
        customOfferDto.number_of_members ||
        1;
      const totalAmount = pricing?.total_amount ?? 0;
      const dueAmount = pricing?.due_amount ?? 0;

      const message = await this.prisma.message.create({
        data: {
          conversation_id: customOfferDto.conversation_id,
          booking_id: customOfferDto.booking_id,
          sender_id: coachId,
          receiver_id: booking.user_id,
          message: `Custom offer: ${offerTitle} for ${memberCount} members. Total: $${totalAmount}. Due: $${dueAmount}.`,
          status: MessageStatus.SENT,
        },
      });

      await this.prisma.conversation.update({
        where: { id: customOfferDto.conversation_id },
        data: { updated_at: DateHelper.now() },
      });

      this.emitConversationMessage(customOfferDto.conversation_id, message, {
        custom_offer: offerResult?.data,
        booking_id: customOfferDto.booking_id,
        message_type: 'CUSTOM_OFFER_SENT',
      });

      return {
        success: true,
        message: 'Custom offer sent successfully',
        data: {
          message_id: message.id,
          conversation_id: message.conversation_id,
          booking_id: customOfferDto.booking_id,
          custom_offer: offerResult?.data,
        },
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
    body: {
      booking_id: string;
      conversation_id: string;
      custom_offer_id: string;
    },
  ) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!body?.booking_id)
      throw new BadRequestException('Booking ID is required');
    if (!body?.conversation_id)
      throw new BadRequestException('Conversation ID is required');
    if (!body?.custom_offer_id)
      throw new BadRequestException('Custom offer ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: body.booking_id, user_id: athleteId },
      select: { id: true, coach_id: true, currency: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    const offer = await this.prisma.customOffer.findFirst({
      where: {
        id: body.custom_offer_id,
        booking_id: booking.id,
        athlete_id: athleteId,
        status: 'PENDING',
      },
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

      this.emitConversationMessage(body.conversation_id, message, {
        message_type: 'CUSTOM_OFFER_ACCEPTED',
      });

      await this.notificationsService.sendNotification({
        type: NotificationType.CUSTOM_OFFER_ACCEPTED,
        recipient_id: booking.coach_id,
        sender_id: athleteId,
        entity_id: booking.id,
        variables: {
          coach_name:
            (
              await this.prisma.user.findUnique({
                where: { id: booking.coach_id },
              })
            )?.name || 'Coach',
          user_name:
            (await this.prisma.user.findUnique({ where: { id: athleteId } }))
              ?.name || 'Athlete',
        },
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
    const paymentIntent = await StripePayment.createManualCapturePaymentIntent({
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

    // Update booking with custom offer details and link payment transaction
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
        custom_offer_payment_transaction_id: tx.id,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversation_id: body.conversation_id,
        sender_id: athleteId,
        receiver_id: booking.coach_id,
        message: `Custom offer accepted.`,
        status: MessageStatus.SENT,
      },
    });

    await this.prisma.conversation.update({
      where: { id: body.conversation_id },
      data: { updated_at: DateHelper.now() },
    });

    this.emitConversationMessage(body.conversation_id, message, {
      message_type: 'CUSTOM_OFFER_ACCEPTED',
      payment_status: 'PENDING',
    });

    await this.notificationsService.sendNotification({
      type: NotificationType.CUSTOM_OFFER_ACCEPTED,
      recipient_id: booking.coach_id,
      sender_id: athleteId,
      entity_id: booking.id,
      variables: {
        coach_name:
          (
            await this.prisma.user.findUnique({
              where: { id: booking.coach_id },
            })
          )?.name || 'Coach',
        user_name:
          (await this.prisma.user.findUnique({ where: { id: athleteId } }))
            ?.name || 'Athlete',
        payment_amount: String(dueAmount),
      },
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
    body: {
      booking_id: string;
      conversation_id: string;
      custom_offer_id: string;
    },
  ) {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!body?.booking_id)
      throw new BadRequestException('Booking ID is required');
    if (!body?.conversation_id)
      throw new BadRequestException('Conversation ID is required');
    if (!body?.custom_offer_id)
      throw new BadRequestException('Custom offer ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: { id: body.booking_id, user_id: athleteId },
      select: { id: true, coach_id: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    const offer = await this.prisma.customOffer.findFirst({
      where: {
        id: body.custom_offer_id,
        booking_id: booking.id,
        athlete_id: athleteId,
        status: 'PENDING',
      },
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

    this.emitConversationMessage(body.conversation_id, message, {
      message_type: 'CUSTOM_OFFER_DECLINED',
    });

    await this.notificationsService.sendNotification({
      type: NotificationType.CUSTOM_OFFER_DECLINED,
      recipient_id: booking.coach_id,
      sender_id: athleteId,
      entity_id: booking.id,
      variables: {
        coach_name:
          (
            await this.prisma.user.findUnique({
              where: { id: booking.coach_id },
            })
          )?.name || 'Coach',
        user_name:
          (await this.prisma.user.findUnique({ where: { id: athleteId } }))
            ?.name || 'Athlete',
      },
    });

    return {
      success: true,
      message: 'Custom offer declined',
      data: { status: 'DECLINED' },
    };
  }

  async updateBookingViaChat(coachId: string, body: BookingUpdateViaChatDto) {

    if (!coachId) throw new BadRequestException('Coach ID is required');

    if (!body?.booking_id)
      throw new BadRequestException('Booking ID is required');
    
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

    this.emitConversationMessage(conversation_id, message, {
      message_type: 'BOOKING_UPDATED',
      updated_booking: result?.data || null,
    });

    return result;
  }
}
