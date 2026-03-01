import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import axios from 'axios';

export interface GooglePlacesResult {
  place_id: string;
  name: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  types: string[];
}

export interface DirectionResult {
  distance: string;
  distance_km: number;
  duration: string;
  duration_minutes: number;
  google_maps_url: string;
  polyline: string;
  steps: DirectionStep[];
}

interface DirectionStep {
  instruction: string;
  distance: string;
  duration: string;
}

@Injectable()
export class MapService {
  private googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  private googlePlacesUrl = 'https://maps.googleapis.com/maps/api/place';
  private googleDirectionsUrl =
    'https://maps.googleapis.com/maps/api/directions';

  constructor(private readonly prisma: PrismaService) {
    if (!this.googleMapsApiKey) {
      console.warn(
        '⚠️ GOOGLE_MAPS_API_KEY is not set in environment variables',
      );
    }
  }

  /**
   * Search locations using Google Places API for all no need to be logged in
   */

  async searchLocationsForAll(
    query: string,
    limit: number = 10,
  ): Promise<any> {

    if (!query || query.trim().length < 2) {
      throw new BadRequestException(
        'Search query must be at least 2 characters',
      );
    }
    if (!this.googleMapsApiKey) {
      throw new BadRequestException('Google Maps API key not configured');
    }
    
    try {      // Use Google Places API Text Search
      const response = await axios.get(
        `${this.googlePlacesUrl}/textsearch/json`,
        {
          params: {
            query: query.trim(),
            key: this.googleMapsApiKey,
          },
        },
      );

      if (
        response.data.status !== 'OK' &&
        response.data.status !== 'ZERO_RESULTS'
      ) {
        throw new BadRequestException(
          `Google Places API error: ${response.data.status}`,
        );
      }

      const results: GooglePlacesResult[] = (response.data.results || [])
        .slice(0, limit)
        .map((place: any) => ({
          place_id: place.place_id,
          name: place.name,
          formatted_address: place.formatted_address,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          types: place.types || [],
        }));

      return {
        success: true,
        message: results.length > 0 ? 'Locations found' : 'No locations found',
        data: {
          query: query.trim(),
          results,
          total: results.length,
        },
      };
    } catch (error) {
      if (error.response?.status === 403) {
        throw new BadRequestException(
          'Google Maps API key is invalid or quota exceeded',
        );
      }
      throw error;
    }
  }

  /**
   * Coach: Search locations using Google Places API
   */
  async searchLocations(
    coachId: string,
    query: string,
    limit: number = 10,
  ): Promise<any> {
    if (!coachId) throw new BadRequestException('Coach ID is required');
    if (!query || query.trim().length < 2) {
      throw new BadRequestException(
        'Search query must be at least 2 characters',
      );
    }
    if (!this.googleMapsApiKey) {
      throw new BadRequestException('Google Maps API key not configured');
    }

    try {
      // Use Google Places API Text Search
      const response = await axios.get(
        `${this.googlePlacesUrl}/textsearch/json`,
        {
          params: {
            query: query.trim(),
            key: this.googleMapsApiKey,
          },
        },
      );

      if (
        response.data.status !== 'OK' &&
        response.data.status !== 'ZERO_RESULTS'
      ) {
        throw new BadRequestException(
          `Google Places API error: ${response.data.status}`,
        );
      }

      const results: GooglePlacesResult[] = (response.data.results || [])
        .slice(0, limit)
        .map((place: any) => ({
          place_id: place.place_id,
          name: place.name,
          formatted_address: place.formatted_address,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          types: place.types || [],
        }));

      return {
        success: true,
        message: results.length > 0 ? 'Locations found' : 'No locations found',
        data: {
          query: query.trim(),
          results,
          total: results.length,
        },
      };
    } catch (error) {
      if (error.response?.status === 403) {
        throw new BadRequestException(
          'Google Maps API key is invalid or quota exceeded',
        );
      }
      throw error;
    }
  }

  /**
   * Coach: Get place details using Google Places API
   */
  async getPlaceDetails(placeId: string): Promise<any> {
    if (!placeId) throw new BadRequestException('Place ID is required');
    if (!this.googleMapsApiKey) {
      throw new BadRequestException('Google Maps API key not configured');
    }

    try {
      const response = await axios.get(`${this.googlePlacesUrl}/details/json`, {
        params: {
          place_id: placeId,
          key: this.googleMapsApiKey,
          fields: 'place_id,name,formatted_address,geometry,types,photos',
        },
      });

      if (response.data.status !== 'OK') {
        throw new BadRequestException(
          `Google Places API error: ${response.data.status}`,
        );
      }

      const result = response.data.result;
      return {
        success: true,
        message: 'Place details retrieved',
        data: {
          place_id: result.place_id,
          name: result.name,
          formatted_address: result.formatted_address,
          latitude: result.geometry.location.lat,
          longitude: result.geometry.location.lng,
          types: result.types || [],
          google_map_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(result.name)}&query_place_id=${placeId}`,
        },
      };
    } catch (error) {
      if (error.response?.status === 403) {
        throw new BadRequestException(
          'Google Maps API key is invalid or quota exceeded',
        );
      }
      throw error;
    }
  }

  /**
   * Coach: Save location to coach profile
   */
  async saveCoachLocation(
    coachId: string,
    placeId: string,
    location: string,
    latitude: number,
    longitude: number,
  ): Promise<any> {
    if (!coachId) throw new BadRequestException('Coach ID is required');

    try {
      const coachProfile = await this.prisma.coachProfile.findUnique({
        where: { user_id: coachId },
      });

      if (!coachProfile) {
        throw new NotFoundException('Coach profile not found');
      }

      const updated = await this.prisma.coachProfile.update({
        where: { id: coachProfile.id },
        data: {
          location: location,
          latitude: latitude,
          longitude: longitude,
        },
        select: {
          id: true,
          location: true,
          latitude: true,
          longitude: true,
        },
      });

      return {
        success: true,
        message: 'Location saved to profile',
        data: updated,
      };
    } catch (error) {
      throw new BadRequestException('Failed to save location to profile');
    }
  }

  /**
   * Athlete: Get session location from booking
   */
  async getSessionLocation(athleteId: string, bookingId: string): Promise<any> {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');

    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        user_id: athleteId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        formatted_address: true,
        latitude: true,
        longitude: true,
        appointment_date: true,
        session_time: true,
        session_time_display: true,
        duration_minutes: true,
        coach_id: true,
        status: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(
        'Booking not found or you do not have access',
      );
    }

    if (!booking.latitude || !booking.longitude) {
      throw new BadRequestException('Session location coordinates are not set');
    }

    // Get coach details
    const coach = await this.prisma.user.findUnique({
      where: { id: booking.coach_id },
      select: {
        id: true,
        name: true,
        avatar: true,
        phone_number: true,
      },
    });

    const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${Number(booking.latitude)},${Number(booking.longitude)}`;

    return {
      success: true,
      message: 'Session location retrieved',
      data: {
        booking_id: booking.id,
        session_title: booking.title || 'Coaching Session',
        session_description: booking.description,
        location: {
          name: booking.location || 'Session Location',
          latitude: Number(booking.latitude),
          longitude: Number(booking.longitude),
          google_maps_link: googleMapsLink,
          has_coordinates: true,
        },
        session_info: {
          appointment_date: booking.appointment_date,
          session_time: booking.session_time,
          session_time_display: booking.session_time_display,
          duration_minutes: booking.duration_minutes,
          status: booking.status,
        },
        coach: {
          id: coach?.id,
          name: coach?.name,
          avatar: coach?.avatar,
          phone_number: coach?.phone_number,
        },
      },
    };
  }

  /**
   * Athlete: Get directions using Google Directions API
   */
  async getDirections(
    athleteId: string,
    bookingId: string,
    originLat: number,
    originLng: number,
  ): Promise<any> {
    if (!athleteId) throw new BadRequestException('Athlete ID is required');
    if (!bookingId) throw new BadRequestException('Booking ID is required');
    if (!originLat || !originLng) {
      throw new BadRequestException(
        'Origin coordinates (latitude, longitude) are required',
      );
    }
    if (!this.googleMapsApiKey) {
      throw new BadRequestException('Google Maps API key not configured');
    }

    // Validate coordinates
    if (originLat < -90 || originLat > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90');
    }
    if (originLng < -180 || originLng > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180');
    }

    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        user_id: athleteId,
      },
      select: {
        id: true,
        location: true,
        latitude: true,
        longitude: true,
        title: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(
        'Booking not found or you do not have access',
      );
    }

    if (!booking.latitude || !booking.longitude) {
      throw new BadRequestException('Session location coordinates are not set');
    }

    const destLat = Number(booking.latitude);
    const destLng = Number(booking.longitude);

    try {
      // Call Google Directions API
      const response = await axios.get(`${this.googleDirectionsUrl}/json`, {
        params: {
          origin: `${originLat},${originLng}`,
          destination: `${destLat},${destLng}`,
          key: this.googleMapsApiKey,
          mode: 'driving',
        },
      });

      if (response.data.status !== 'OK') {
        throw new BadRequestException(
          `Google Directions API error: ${response.data.status}`,
        );
      }

      const route = response.data.routes[0];
      if (!route) {
        throw new NotFoundException(
          'No route found between origin and destination',
        );
      }

      const leg = route.legs[0];
      const distanceValue = leg.distance.value / 1000; // Convert meters to km
      const durationSeconds = leg.duration.value;
      const durationMinutes = Math.ceil(durationSeconds / 60);

      // Format steps
      const steps = leg.steps.map((step: any) => ({
        instruction: step.html_instructions?.replace(/<[^>]*>/g, '') || '',
        distance: step.distance.text,
        duration: step.duration.text,
      }));

      // Google Maps navigation URL
      const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`;

      return {
        success: true,
        message: 'Directions retrieved',
        data: {
          booking_id: booking.id,
          session_title: booking.title || 'Coaching Session',
          origin: {
            latitude: originLat,
            longitude: originLng,
          },
          destination: {
            name: booking.location || 'Session Location',
            latitude: destLat,
            longitude: destLng,
          },
          distance: {
            value_km: Number(distanceValue.toFixed(2)),
            text: leg.distance.text,
          },
          estimated_duration: {
            value_minutes: durationMinutes,
            text: leg.duration.text,
          },
          directions_url: googleMapsUrl,
          polyline: route.overview_polyline.points,
          steps: steps,
        },
      };
    } catch (error) {
      if (error.response?.status === 403) {
        throw new BadRequestException(
          'Google Maps API key is invalid or quota exceeded',
        );
      }
      throw error;
    }
  }

  /**
   * Get nearby coaches with location coordinates
   */
  async getNearbyCoaches(
    latitude: number,
    longitude: number,
    radiusKm: number = 10,
    limit: number = 20,
  ): Promise<any> {
    if (!latitude || !longitude) {
      throw new BadRequestException('Latitude and longitude are required');
    }

    if (latitude < -90 || latitude > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180');
    }

    // Get coach profiles with coordinates
    const coaches = await this.prisma.coachProfile.findMany({
      where: {
        latitude: { not: null },
        longitude: { not: null },
        status: 1,
      },
      select: {
        id: true,
        user_id: true,
        location: true,
        latitude: true,
        longitude: true,
        primary_specialty: true,
        specialties: true,
        session_price: true,
        hourly_currency: true,
        avg_rating: true,
        rating_count: true,
        is_verified: true,
      },
      take: 100,
    });

    // Calculate distances and filter by radius
    const nearbyCoaches = coaches
      .map((coach) => {
        const distance = this.calculateDistance(
          latitude,
          longitude,
          Number(coach.latitude!),
          Number(coach.longitude!),
        );

        return {
          ...coach,
          distance_km: Number(distance.toFixed(2)),
        };
      })
      .filter((coach) => coach.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, limit);

    // Get user details for nearby coaches
    const userIds = nearbyCoaches.map((c) => c.user_id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        avatar: true,
        bio: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const results = nearbyCoaches.map((coach) => ({
      coach_id: coach.user_id,
      profile_id: coach.id,
      name: userMap.get(coach.user_id)?.name || 'Coach',
      avatar: userMap.get(coach.user_id)?.avatar,
      bio: userMap.get(coach.user_id)?.bio,
      location: {
        name: coach.location || 'Coach Location',
        latitude: Number(coach.latitude),
        longitude: Number(coach.longitude),
        distance_km: coach.distance_km,
        distance_text: `${coach.distance_km} km away`,
      },
      specialty: coach.primary_specialty,
      specialties: coach.specialties,
      session_price: coach.session_price ? Number(coach.session_price) : null,
      currency: coach.hourly_currency,
      avg_rating: coach.avg_rating ? Number(coach.avg_rating) : null,
      rating_count: coach.rating_count,
      is_verified: coach.is_verified,
    }));

    return {
      success: true,
      message:
        results.length > 0
          ? 'Nearby coaches found'
          : 'No coaches found in this area',
      data: {
        center: { latitude, longitude },
        radius_km: radiusKm,
        coaches: results,
        total: results.length,
      },
    };
  }

  /**
   * Helper: Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
