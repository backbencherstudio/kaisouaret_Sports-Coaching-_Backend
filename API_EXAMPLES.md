# Blocked Time Slot API Examples

## Block a Time Slot

Based on the UI (Date, Start Time, End Time format):

**POST** `/booking/coach/blocked-time-slots`

**Request Body:**
```json
{
  "date": "2026-02-15",
  "startTime": "7:00 PM",
  "endTime": "8:00 PM"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Time slot blocked successfully",
  "data": {
    "id": "clxy123abc",
    "coach_profile_id": "clx456def",
    "date": "2026-02-15T00:00:00.000Z",
    "start_time": "7:00 PM",
    "end_time": "8:00 PM",
    "created_at": "2026-01-25T05:00:00.000Z",
    "updated_at": "2026-01-25T05:00:00.000Z"
  }
}
```

## Get All Blocked Time Slots

**GET** `/booking/coach/:coachId/blocked-time-slots`

**Response:**
```json
{
  "success": true,
  "message": "Blocked time slots retrieved successfully",
  "data": [
    {
      "id": "clxy123abc",
      "coach_profile_id": "clx456def",
      "date": "2026-02-15T00:00:00.000Z",
      "start_time": "7:00 PM",
      "end_time": "8:00 PM",
      "created_at": "2026-01-25T05:00:00.000Z",
      "updated_at": "2026-01-25T05:00:00.000Z"
    },
    {
      "id": "clxy789xyz",
      "coach_profile_id": "clx456def",
      "date": "2026-02-20T00:00:00.000Z",
      "start_time": "2:00 PM",
      "end_time": "4:00 PM",
      "created_at": "2026-01-25T05:00:00.000Z",
      "updated_at": "2026-01-25T05:00:00.000Z"
    }
  ]
}
```

## Time Format Support

The API accepts flexible time formats:
- **12-hour format**: "7:00 PM", "8:30 AM", "12:00 PM"
- **24-hour format**: "14:00", "19:30", "23:45"

## Features

✅ **Date-based blocking**: Block specific dates with start and end times  
✅ **Duplicate detection**: Prevents blocking the same time slot twice  
✅ **Automatic cleanup**: Expired time slots are automatically deleted (runs hourly)  
✅ **Notifications**: Coach receives notification when time slot is blocked  
✅ **Validation**: Validates date and time formats before saving  

## Database Structure

The system now uses a dedicated `BlockedTimeSlot` model:

```prisma
model BlockedTimeSlot {
  id               String       @id @default(cuid())
  created_at       DateTime     @default(now())
  updated_at       DateTime     @default(now())
  coach_profile_id String
  coach_profile    CoachProfile @relation(...)
  date             DateTime     @db.Date
  start_time       String
  end_time         String
}
```

This allows:
- Better querying and filtering
- Easier cleanup of expired slots
- More precise time range blocking
- Better scalability
