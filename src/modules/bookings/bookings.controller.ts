import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@ApiTags('booking')
@UseGuards(JwtAuthGuard)
@Controller('booking')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @ApiOperation({ summary: 'blocked days for a coach' })
  @Post('coach/blocked-days')
  async setBlockedDays(
    @GetUser('userId') coachId: string,
    @Body('blockedDays') blockedDays: string[],
  ) {
    return this.bookingsService.setBlockedDays(coachId, blockedDays);
  }

  @ApiOperation({ summary: 'get coach blocked days for all' })
  @Get('coach/:coachId/blocked-days')
  async getBlockedDays(@Param('coachId') coachId: string) {
    return this.bookingsService.blockedDays(coachId);
  }

  @ApiOperation({ summary: 'get blocked time slots for a coach' })
  @Get('coach/:coachId/blocked-time-slots')
  async getBlockedTimeSlots(@Param('coachId') coachId: string) {
    return this.bookingsService.blockedTimeSlots(coachId);
  }

  @ApiOperation({ summary: 'set blocked time slots for a coach' })
  @Post('coach/blocked-time-slots')
  async setBlockedTimeSlots(
    @GetUser('userId') coachId: string,
    @Body('date') date: string,
    @Body('startTime') startTime: string,
    @Body('endTime') endTime: string,
  ) {
    return this.bookingsService.setBlockedTimeSlots(
      coachId,
      date,
      startTime,
      endTime,
    );
  }

  @ApiOperation({ summary: 'set weekend days for a coach' })
  @Post('coach/weekend-days')
  async setWeekendDays(
    @GetUser('userId') coachId: string,
    @Body('weekendDay') weekendDay: string,
  ) {
    return this.bookingsService.setWeekendDays(coachId, weekendDay);
  }

  @ApiOperation({ summary: 'get weekend days for a coach' })
  @Get('coach/:coachId/weekend-days')
  async getWeekendDays(@Param('coachId') coachId: string) {
    return this.bookingsService.weekendDays(coachId);
  }

  @ApiOperation({ summary: 'get available days for a coach' })
  @Get('coach/:coachId/available-days')
  async getAvailableDays(@Param('coachId') coachId: string) {
    return this.bookingsService.getAvailableDays(coachId);
  }

  @ApiOperation({ summary: 'Find coaches by date availability' })
  @Post('coaches/available-date/:date')
  async findCoachesByDateAvailability(@Param('date') date: string) {
    return this.bookingsService.findCoachesByDateAvailability(date);
  }

  @ApiOperation({ summary: 'booked a new appointment by athlete' })
  @Post('coach/:coachId')
  async bookAppointment(
    @GetUser('userId') athleteId: string,
    @Param('coachId') coachId: string,
    @Body('date') date: string,
    @Body('sessionPackageId') sessionPackageId: string,
  ) {
    // JwtStrategy returns { userId, email } so we read userId from req.user and treat it as athleteId here
    return this.bookingsService.bookAppointment(
      athleteId,
      coachId,
      date,
      sessionPackageId,
    );
  }

  @ApiOperation({ summary: 'get all bookings for especific athlete' })
  @Get('athlete')
  async getAthleteBookings(
    @GetUser('userId') athleteId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    console.log('hit in all booking');
    return this.bookingsService.getAthleteBookings(
      athleteId,
      Number(page) || 1,
      Number(limit) || 10,
      status,
    );
  }

  @ApiOperation({ summary: 'get all bookings for especific athlete by date' })
  @Get('athlete/date/:date')
  async getAthleteBookingsByDate(
    @GetUser('userId') athleteId: string,
    @Param('date') date: string,
    @Query('status') status?: string,
  ) {
    console.log('hit in the booking by date');
    return this.bookingsService.getAthleteBookingsByDate(
      athleteId,
      date,
      status,
    );
  }

  // (booking-by-id and token endpoints are defined later to avoid route-order collisions)

  @ApiOperation({ summary: 'get upcoming bookings for logged-in user' })
  @Get('upcoming')
  async getUpcomingBookings(@GetUser('userId') userId: string) {
    console.log('hit test');
    return this.bookingsService.getUpcomingBookings(userId);
  }

  @ApiOperation({ summary: 'get next upcoming session for logged-in user' })
  @Get('next')
  async getNextUpcomingSession(@GetUser('userId') userId: string) {
    return this.bookingsService.getNextUpcomingSession(userId);
  }

  @ApiOperation({ summary: 'get session details for logged-in user' })
  @Get('session/details/:bookingId')
  async getSessionDetails(
    @GetUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.bookingsService.getSessionDetails(userId, bookingId);
  }

  @ApiOperation({ summary: 'get completed bookings for logged-in user' })
  @Get('completed')
  async getCompletedBookings(@GetUser('userId') userId: string) {
    return this.bookingsService.getCompletedBookings(userId);
  }

  @ApiOperation({ summary: 'get all bookings for especific coach' })
  @Get('coach/all')
  async getCoachBookings(
    @GetUser('userId') coachId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.bookingsService.getCoachBookings(
      coachId,
      Number(page) || 1,
      Number(limit) || 10,
      status,
    );
  }

  @ApiOperation({ summary: 'get all bookings for especific coach by date' })
  @Get('coach/all/date/:date')
  async getCoachBookingsByDate(
    @GetUser('userId') coachId: string,
    @Param('date') date: string,
    @Query('status') status?: string,
  ) {
    return this.bookingsService.getCoachBookingsByDate(coachId, date, status);
  }

  @ApiOperation({ summary: 'get a booking by coach' })
  @Get(':bookingId/coach')
  async getBookingByIdForCoach(
    @GetUser('userId') coachId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.bookingsService.getBookingByIdForCoach(coachId, bookingId);
  }

  @ApiOperation({ summary: 'cancel a booking by coach' })
  @Delete(':bookingId/cancel')
  async cancelBooking(
    @GetUser('userId') coachId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.bookingsService.cancelBooking(coachId, bookingId);
  }

  @ApiOperation({ summary: 'get cancelled bookings for logged-in user' })
  @Get('cancelled')
  async getCancelledBookings(@GetUser('userId') userId: string) {
    return this.bookingsService.getCancelledBookings(userId);
  }

  @ApiOperation({ summary: 'get test' })
  @Get('coach/test/test')
  async test(@GetUser('userId') coachId: string) {
    console.log('CoachId', coachId);
  }

  @ApiOperation({ summary: 'coach validates a completed session using token' })
  @Post(':bookingId/validate')
  async validateBookingToken(
    @GetUser('userId') coachId: string,
    @Param('bookingId') bookingId: string,
    @Body('token') token: string,
    @Res() res: any,
  ) {
    const result = await this.bookingsService.validateBookingToken(
      coachId,
      bookingId,
      token,
    );
    return res.status(result.statusCode).json({
      success: true,
      statusCode: result.statusCode,
      message: result.message,
      data: result.data,
    });
  }

  // Reinsert athlete booking-by-id and token endpoints here (after literal routes)
  @ApiOperation({ summary: 'get a booking by id from athlete' })
  @Get(':bookingId')
  async getBookingById(
    @GetUser('userId') athleteId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.bookingsService.getBookingById(athleteId, bookingId);
  }

  // @ApiOperation({ summary: 'generate a validation token for a booking by athlete' })
  // @Post(':bookingId/token')
  // async generateBookingValidationToken(
  //   @GetUser('userId') athleteId: string,
  //   @Param('bookingId') bookingId: string,
  // ) {
  //   return this.bookingsService.generateBookingValidationToken(athleteId, bookingId);
  // }

  @ApiOperation({
    summary: "athlete fetches the booking's validation token (if available)",
  })
  @Get(':bookingId/token')
  async getBookingToken(
    @GetUser('userId') athleteId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.bookingsService.getBookingToken(athleteId, bookingId);
  }

  @ApiOperation({ summary: 'update a booking by coach only' })
  @Patch(':bookingId')
  async updateBooking(
    @GetUser('userId') coachId: string,
    @Param('bookingId') bookingId: string,
    @Body() updateBookingDto: UpdateBookingDto,
  ) {
    return this.bookingsService.updateBooking(
      coachId,
      bookingId,
      updateBookingDto,
    );
  }

  //
  // ------------------------- session package -----------------------
  //

  @ApiOperation({ summary: 'create a session package' })
  @ApiTags('session')
  @Post('session-package')
  async createSessionPackage(
    @GetUser('userId') coachId: string,
    @Body() createSessionPackageDto: any,
  ) {
    return this.bookingsService.createSessionPackage(
      coachId,
      createSessionPackageDto,
    );
  }

  @ApiOperation({ summary: 'get all session packages' })
  @ApiTags('session')
  @Get('session/packages')
  async getSessionPackages(@GetUser('userId') coachId: string) {
    return this.bookingsService.getSessionPackages(coachId);
  }

  @ApiOperation({ summary: 'update a session package' })
  @Patch('session/package/:id')
  async updateSessionPackage(
    @GetUser('userId') coachId: string,
    @Param('id') id: string,
    @Body() updateSessionPackageDto: any,
  ) {
    return this.bookingsService.updateSessionPackage(
      coachId,
      id,
      updateSessionPackageDto,
    );
  }

  @ApiOperation({ summary: 'delete a session package' })
  @Delete('session/package/:id')
  async deleteSessionPackage(
    @GetUser('userId') coachId: string,
    @Param('id') id: string,
  ) {
    return this.bookingsService.deleteSessionPackage(coachId, id);
  }

  @ApiOperation({ summary: 'get suggested coaches for athlete' })
  @Get('suggested/coaches')
  async getSuggestedCoaches(@GetUser('userId') athleteId: string) {
    return this.bookingsService.getSuggestedCoaches(athleteId);
  }

  @ApiOperation({ summary: 'search coaches by speciality or others' })
  @Post('search/coaches')
  async getSearchCoaches(
    @GetUser('userId') athleteId: string,
    @Body('searchText') searchText: string,
  ) {
    return this.bookingsService.getSearchCoaches(athleteId, searchText);
  }

  @ApiOperation({ summary: 'get selected coach details' })
  @Get('coach/:coachId/details')
  async getCoachDetails(@Param('coachId') coachId: string) {
    return this.bookingsService.getCoachDetails(coachId);
  }

  @ApiOperation({ summary: 'get selected athlete details' })
  @Get('athlete/:athleteId/details')
  async getAthleteDetails(
    @GetUser('userId') coachId: string,
    @Param('athleteId') athleteId: string,
  ) {
    return this.bookingsService.getAthleteDetails(coachId, athleteId);
  }
}
