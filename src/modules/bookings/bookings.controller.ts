import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
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
  @Post('coach/:coachId/blocked-days')
  async setBlockedDays(
    @GetUser('userId') coachId: string,
    @Body('blockedDays') blockedDays: string[],
  ) {
    return this.bookingsService.setBlockedDays(coachId, blockedDays);
  }

  @ApiOperation({ summary: 'get blocked days for a coach' })
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
  @Post('coach/:coachId/blocked-time-slots')
  async setBlockedTimeSlots(
    @GetUser('userId') coachId: string,
    @Body('blockedTimeSlots') blockedTimeSlots: string[],
  ) {
    return this.bookingsService.setBlockedTimeSlots(coachId, blockedTimeSlots);
  }

  @ApiOperation({ summary: 'set weekend days for a coach' })
  @Post('coach/:coachId/weekend-days')
  async setWeekendDays(
    @GetUser('userId') coachId: string,
    @Body('weekendDays') weekendDays: string[],
  ) {
    return this.bookingsService.setWeekendDays(coachId, weekendDays);
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
  @Get('athlete/:athleteId')
  async getAthleteBookings(@Param('athleteId') athleteId: string) {
    return this.bookingsService.getAthleteBookings(athleteId);
  }

  @ApiOperation({ summary: 'get all bookings for especific athlete by date' })
  @Get('athlete/:athleteId/date/:date')
  async getAthleteBookingsByDate(
    @Param('athleteId') athleteId: string,
    @Param('date') date: string,
  ) {
    return this.bookingsService.getAthleteBookingsByDate(athleteId, date);
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

  @ApiOperation({ summary: 'get completed bookings for logged-in user' })
  @Get('completed')
  async getCompletedBookings(@GetUser('userId') userId: string) {
    return this.bookingsService.getCompletedBookings(userId);
  }

  @ApiOperation({ summary: 'send review to coach' })
  // Review endpoints were moved to the separate `reviews` module.
  @ApiOperation({ summary: 'get all bookings for especific coach' })
  @Get('coach/:coachId')
  async getCoachBookings(@Param('coachId') coachId: string) {
    return this.bookingsService.getCoachBookings(coachId);
  }

  @ApiOperation({ summary: 'get all bookings for especific coach by date' })
  @Get('coach/:coachId/date/:date')
  async getCoachBookingsByDate(
    @Param('coachId') coachId: string,
    @Param('date') date: string,
  ) {
    return this.bookingsService.getCoachBookingsByDate(coachId, date);
  }

  @ApiOperation({ summary: 'get a booking by coach' })
  @Get(':bookingId/coach')
  async getBookingByIdForCoach(
    @GetUser('userId') coachId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.bookingsService.getBookingByIdForCoach(coachId, bookingId);
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
  ) {
    return this.bookingsService.validateBookingToken(coachId, bookingId, token);
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
  @Get('search/coaches')
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
}
