import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaClient } from '@prisma/client';
import appConfig from '../../../config/app.config';
// Update the import path below to the correct location of SazedStorage
import { SazedStorage } from '../../../common/lib/Disk/SazedStorage';
import { DateHelper } from '../../../common/helper/date.helper';
import { MessageGateway } from '../message/message.gateway';

@Injectable()
export class ConversationService {
  constructor(
    private prisma: PrismaService,
    private readonly messageGateway: MessageGateway,
  ) {}

  async create(payload: { creator_id: string; participant_id: string }) {
    try {
      const data: any = {};

      if (payload.creator_id) {
        data.creator_id = payload.creator_id;
      }
      if (payload.participant_id) {
        data.participant_id = payload.participant_id;
      }

      // validate users exist and ensure conversations are between a coach and an athlete
      const creatorUser = await this.prisma.user.findUnique({
        where: { id: data.creator_id },
      });
      if (!creatorUser) {
        throw new NotFoundException('Creator user not found');
      }
      const participantUser = await this.prisma.user.findUnique({
        where: { id: data.participant_id },
      });
      if (!participantUser) {
        throw new NotFoundException('Participant user not found');
      }

      const creatorIsCoach = creatorUser.type === 'coach';
      const participantIsCoach = participantUser.type === 'coach';

      // require conversations to be between a coach and a non-coach (athlete)
      const validPair =
        (creatorIsCoach && !participantIsCoach) ||
        (participantIsCoach && !creatorIsCoach);
      if (!validPair) {
        throw new ForbiddenException(
          'Conversations are limited to coach <-> athlete interactions',
        );
      }

      // check if conversation exists
      let conversation = await this.prisma.conversation.findFirst({
        select: {
          id: true,
          creator_id: true,
          participant_id: true,
          created_at: true,
          updated_at: true,
          creator: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          participant: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          messages: {
            orderBy: {
              created_at: 'desc',
            },
            take: 1,
            select: {
              id: true,
              message: true,
              created_at: true,
            },
          },
        },
        where: {
          creator_id: data.creator_id,
          participant_id: data.participant_id,
        },
      });

      if (conversation) {
        return {
          success: false,
          message: 'Conversation already exists',
          data: conversation,
        };
      }

      conversation = await this.prisma.conversation.create({
        select: {
          id: true,
          creator_id: true,
          participant_id: true,
          created_at: true,
          updated_at: true,
          creator: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          participant: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          messages: {
            orderBy: {
              created_at: 'desc',
            },
            take: 1,
            select: {
              id: true,
              message: true,
              created_at: true,
            },
          },
        },
        data: {
          ...data,
        },
      });

      // add image url
      if (conversation.creator.avatar) {
        conversation.creator['avatar_url'] = SazedStorage.url(
          appConfig().storageUrl.avatar + conversation.creator.avatar,
        );
      }
      if (conversation.participant.avatar) {
        conversation.participant['avatar_url'] = SazedStorage.url(
          appConfig().storageUrl.avatar + conversation.participant.avatar,
        );
      }

      // trigger socket event
      this.messageGateway.server.to(data.creator_id).emit('conversation', {
        from: data.creator_id,
        data: conversation,
      });
      this.messageGateway.server.to(data.participant_id).emit('conversation', {
        from: data.participant_id,
        data: conversation,
      });

      return {
        success: true,
        message: 'Conversation created successfully',
        data: conversation,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findAll() {
    try {
      const conversations = await this.prisma.conversation.findMany({
        orderBy: {
          updated_at: 'desc',
        },
        select: {
          id: true,
          creator_id: true,
          participant_id: true,
          created_at: true,
          updated_at: true,
          creator: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          participant: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          messages: {
            orderBy: {
              created_at: 'desc',
            },
            take: 1,
            select: {
              id: true,
              message: true,
              created_at: true,
            },
          },
        },
      });

      // add image url
      for (const conversation of conversations) {
        if (conversation.creator.avatar) {
          conversation.creator['avatar_url'] = SazedStorage.url(
            appConfig().storageUrl.avatar + conversation.creator.avatar,
          );
        }
        if (conversation.participant.avatar) {
          conversation.participant['avatar_url'] = SazedStorage.url(
            appConfig().storageUrl.avatar + conversation.participant.avatar,
          );
        }
      }

      return {
        success: true,
        data: conversations,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findOne(id: string) {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id },
        select: {
          id: true,
          creator_id: true,
          participant_id: true,
          created_at: true,
          updated_at: true,
          creator: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          participant: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      });

      // add image url
      if (conversation.creator.avatar) {
        conversation.creator['avatar_url'] = SazedStorage.url(
          appConfig().storageUrl.avatar + conversation.creator.avatar,
        );
      }

      return {
        success: true,
        data: conversation,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // async update(id: string, updateConversationDto: UpdateConversationDto) {
  //   try {
  //     const data = {};
  //     if (updateConversationDto.creator_id) {
  //       data['creator_id'] = updateConversationDto.creator_id;
  //     }
  //     if (updateConversationDto.participant_id) {
  //       data['participant_id'] = updateConversationDto.participant_id;
  //     }

  //     await this.prisma.conversation.update({
  //       where: { id },
  //       data: {
  //         ...data,
  //         updated_at: DateHelper.now(),
  //       },
  //     });

  //     return {
  //       success: true,
  //       message: 'Conversation updated successfully',
  //     };
  //   } catch (error) {
  //     return {
  //       success: false,
  //       message: error.message,
  //     };
  //   }
  // }

  async remove(id: string) {
    try {
      await this.prisma.conversation.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Conversation deleted successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
