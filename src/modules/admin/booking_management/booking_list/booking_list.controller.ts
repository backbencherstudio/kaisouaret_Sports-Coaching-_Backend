import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { ApiOperation, ApiQuery, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { BookingListService } from './booking_list.service';
import { CreateBookingListDto } from './dto/create-booking_list.dto';
import { UpdateBookingListDto } from './dto/update-booking_list.dto';
import { QueryBookingListDto } from './dto/query-booking-list.dto';
import { SendBulkNotificationDto } from './dto/send-bulk-notification.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guard/role/roles.guard';
import { Roles } from '../../../../common/guard/role/roles.decorator';
import { Role } from '../../../../common/guard/role/role.enum';
import { UseGuards } from '@nestjs/common';

@ApiBearerAuth()
@ApiTags('Booking List')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/booking-list')
export class BookingListController {
  constructor(private readonly bookingListService: BookingListService) {}

  @ApiOperation({ summary: 'Create a new booking with image upload' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
    }),
  )
  @Post()
  async create(
    @Body() createBookingListDto: CreateBookingListDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.bookingListService.create(createBookingListDto, image);
  }

  @ApiOperation({ summary: 'Get all bookings with search, filter, and pagination' })
  @Get()
  async findAll(
    @Query() query: QueryBookingListDto,
  ) {
    return this.bookingListService.findAll(query);
  }

  @ApiOperation({ summary: 'Get performance metrics dashboard' })
  @Get('metrics')
  async getMetrics() {
    return this.bookingListService.getMetrics();
  }

  @ApiOperation({ summary: 'Send bulk notifications' })
  @ApiBody({ type: SendBulkNotificationDto })
  @Post('send-bulk-notification')
  async sendBulkNotification(
    @Body() sendBulkNotificationDto: SendBulkNotificationDto,
  ) {
    return this.bookingListService.sendBulkNotification(sendBulkNotificationDto);
  }

  @ApiOperation({ summary: 'Check notification delivery status by event ID' })
  @Get('notification-status/:eventId')
  async checkNotificationStatus(@Param('eventId') eventId: string) {
    return this.bookingListService.checkNotificationStatus(eventId);
  }

  @ApiOperation({ summary: 'Get notifications for a specific user (for recipients to check)' })
  @Get('user-notifications/:userId')
  async getUserNotifications(@Param('userId') userId: string) {
    return this.bookingListService.getUserNotifications(userId);
  }

  @ApiOperation({ summary: 'Export booking data' })
  @Get('export')
  async exportBookings(
    @Query() query: QueryBookingListDto,
    @Res() res: Response,
  ) {
    return this.bookingListService.exportBookings(query, res);
  }

  @ApiOperation({ summary: 'Get booking details by ID' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.bookingListService.findOne(id);
  }

  @ApiOperation({ summary: 'Update booking by ID' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateBookingListDto: UpdateBookingListDto,
  ) {
    return this.bookingListService.update(id, updateBookingListDto);
  }

  @ApiOperation({ summary: 'Delete booking by ID' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.bookingListService.remove(id);
  }
}
