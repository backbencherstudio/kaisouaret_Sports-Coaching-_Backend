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
} from '@nestjs/common';
import { MapService } from './map.service';
import { ApiOperation, ApiTags, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@ApiTags('map')
@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  // ==================== COMMON ENDPOINTS ====================

  @ApiOperation({ summary: 'Search locations using Google Places API for all' })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'Location name or address',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum results',
    type: Number,
  })
  @Get('search')
  async searchLocationsForAll(
    @Query('query') query: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.mapService.searchLocationsForAll(query, limitNum);
  }

  // ==================== COACH ENDPOINTS ====================
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Coach: Search locations using Google Places API' })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'Location name or address',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum results',
    type: Number,
  })
  @Get('coach/search')
  async searchLocations(
    @GetUser('userId') coachId: string,
    @Query('query') query: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.mapService.searchLocations(coachId, query, limitNum);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Coach: Get place details by Google place_id' })
  @ApiQuery({
    name: 'placeId',
    required: true,
    description: 'Google Places API place_id',
  })
  @Get('coach/place-details')
  async getPlaceDetails(
    @GetUser('userId') coachId: string,
    @Query('placeId') placeId: string,
  ) {
    return this.mapService.getPlaceDetails(placeId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Coach: Save location to coach profile' })
  @Post('coach/save-location')
  async saveCoachLocation(
    @GetUser('userId') coachId: string,
    @Body()
    body: {
      placeId: string;
      location: string;
      latitude: number;
      longitude: number;
    },
  ) {
    return this.mapService.saveCoachLocation(
      coachId,
      body.placeId,
      body.location,
      body.latitude,
      body.longitude,
    );
  }

  // ==================== ATHLETE ENDPOINTS ====================
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Athlete: Get session location on map' })
  @Get('athlete/session/:bookingId')
  async getSessionLocation(
    @GetUser('userId') athleteId: string,
    @Param('bookingId') bookingId: string,
  ) {
    return this.mapService.getSessionLocation(athleteId, bookingId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Athlete: Get directions to session location using Google Directions API',
  })
  @ApiQuery({
    name: 'originLat',
    required: true,
    description: 'Your current latitude',
    type: Number,
  })
  @ApiQuery({
    name: 'originLng',
    required: true,
    description: 'Your current longitude',
    type: Number,
  })
  @Get('athlete/directions/:bookingId')
  async getDirections(
    @GetUser('userId') athleteId: string,
    @Param('bookingId') bookingId: string,
    @Query('originLat') originLat: string,
    @Query('originLng') originLng: string,
  ) {
    return this.mapService.getDirections(
      athleteId,
      bookingId,
      parseFloat(originLat),
      parseFloat(originLng),
    );
  }

  // ==================== EXPLORATION ENDPOINTS ====================

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Explore nearby coaches on map' })
  @ApiQuery({
    name: 'latitude',
    required: true,
    description: 'Center latitude',
    type: Number,
  })
  @ApiQuery({
    name: 'longitude',
    required: true,
    description: 'Center longitude',
    type: Number,
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    description: 'Search radius in km',
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum results',
    type: Number,
  })
  @Get('explore/nearby-coaches')
  async getNearbyCoaches(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radiusKm') radiusKm?: string,
    @Query('limit') limit?: string,
  ) {
    const radiusNum = radiusKm ? parseInt(radiusKm, 10) : 10;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.mapService.getNearbyCoaches(
      parseFloat(latitude),
      parseFloat(longitude),
      radiusNum,
      limitNum,
    );
  }
}
