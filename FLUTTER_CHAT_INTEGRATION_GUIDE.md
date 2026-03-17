# Flutter Chat Module Integration Guide

## Overview

The backend provides a **hybrid REST + WebSocket** chat system for real-time messaging between athletes and coaches. This guide documents all APIs, data models, WebSocket events, and best practices for Flutter integration.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│              Flutter Mobile App                  │
└────────────────┬────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
    ┌────▼────┐     ┌───▼────┐
    │   REST  │     │WebSocket│
    │   Calls │     │(Socket.io)
    │         │     │         │
    └────┬────┘     └───┬────┘
         │              │
         └──────┬───────┘
                │
        ┌───────▼───────────┐
        │  NestJS Backend   │
        │  + Socket.io      │
        └───────────────────┘
```

**Communication Pattern:**
- **REST Endpoints**: Conversation CRUD, message history (pagination)
- **WebSocket Events**: Real-time message delivery, typing indicators, status updates
- **Authentication**: JWT token (obtained from login) attached to both REST and WebSocket connections

---

## Authentication

### 1. Obtain JWT Token

Login first using your auth endpoint. The response contains a JWT token:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user123",
    "email": "athlete@example.com",
    "user_type": "ATHLETE"
  }
}
```

### 2. Attach Token to Requests

**For REST calls**, add to header:
```
Authorization: Bearer <your_access_token>
```

**For WebSocket**, pass in Socket.io connection options:
```dart
final socket = IO.Socket(
  baseURL,
  IO.SocketOptions(
    autoConnect: true,
    auth: {
      'token': accessToken,
    },
  ),
);
```

---

## REST Endpoints

### Base URL
```
https://your-backend.com/api/chat
```

### 1. Create Conversation

**Endpoint:** `POST /conversation/create`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "participant_id": "coach123"
}
```

**Response:**
```json
{
  "id": "conv123",
  "creator_id": "athlete123",
  "participant_id": "coach123",
  "created_at": "2025-01-20T10:15:30Z",
  "updated_at": "2025-01-20T10:15:30Z"
}
```

**Error Responses:**
```json
{
  "statusCode": 400,
  "message": "Conversation with this participant already exists"
}
```

---

### 2. Get All Conversations

**Endpoint:** `GET /conversation/all`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:** (Optional)
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 10)

**Response:**
```json
[
  {
    "id": "conv123",
    "creator_id": "athlete123",
    "participant_id": "coach123",
    "created_at": "2025-01-20T10:15:30Z",
    "updated_at": "2025-01-20T10:15:30Z",
    "messages": [
      {
        "id": "msg1",
        "sender_id": "coach123",
        "receiver_id": "athlete123",
        "conversation_id": "conv123",
        "message": "Hello! How can I help?",
        "status": "DELIVERED",
        "attachment_id": null,
        "created_at": "2025-01-20T10:16:00Z"
      }
    ]
  }
]
```

---

### 3. Get Conversation by ID

**Endpoint:** `GET /conversation/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** (Same as single conversation object above)

---

### 4. Delete Conversation

**Endpoint:** `DELETE /conversation/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation deleted"
}
```

---

### 5. Send Message

**Endpoint:** `POST /message`

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body (Text Only):**
```json
{
  "receiver_id": "coach123",
  "conversation_id": "conv123",
  "message": "Can we reschedule?"
}
```

**Request Body (With File Attachment - Multipart):**
```
POST /message
Content-Type: multipart/form-data

receiver_id=coach123
conversation_id=conv123
message=Check this video
file=<binary_video_data>
```

**Response:**
```json
{
  "id": "msg456",
  "sender_id": "athlete123",
  "receiver_id": "coach123",
  "conversation_id": "conv123",
  "message": "Can we reschedule?",
  "status": "PENDING",
  "attachment_id": null,
  "created_at": "2025-01-20T10:17:00Z"
}
```

---

### 6. Get Messages with Pagination

**Endpoint:** `GET /message/:conversation_id`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `limit`: Results per page (default: 20)
- `cursor`: Pagination cursor (optional, for fetching older messages)

**First Request (No Cursor):**
```
GET /message/conv123?limit=20
```

**Subsequent Requests (Cursor-based):**
```
GET /message/conv123?limit=20&cursor=msg456
```

**Response:**
```json
{
  "data": [
    {
      "id": "msg456",
      "sender_id": "athlete123",
      "receiver_id": "coach123",
      "conversation_id": "conv123",
      "message": "Can we reschedule?",
      "status": "DELIVERED",
      "attachment": null,
      "created_at": "2025-01-20T10:17:00Z"
    },
    {
      "id": "msg789",
      "sender_id": "coach123",
      "receiver_id": "athlete123",
      "conversation_id": "conv123",
      "message": "Sure, check my availability",
      "status": "READ",
      "attachment": {
        "id": "att123",
        "name": "calendar.png",
        "type": "image/png",
        "size": 15360,
        "file": "https://s3.amazonaws.com/bucket/attachments/calendar.png",
        "file_alt": "Availability calendar",
        "format": "image",
        "width": 800,
        "height": 600,
        "thumbnail": null
      },
      "created_at": "2025-01-20T10:18:00Z"
    }
  ],
  "nextCursor": "msg789",
  "hasMore": true
}
```

---

### 7. Update Message Status

**Endpoint:** `PUT /message/:message_id`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "status": "READ"
}
```

**Status Options:** `PENDING`, `DELIVERED`, `READ`

**Response:**
```json
{
  "id": "msg456",
  "status": "READ",
  "updated_at": "2025-01-20T10:20:00Z"
}
```

---

### 8. Send Custom Offer (Coach → Athlete)

**Endpoint:** `POST /message/custom-offer`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "conversation_id": "conv123",
  "session_count": 5,
  "price_per_session": 50.0,
  "discount_percentage": 10,
  "total_price": 225.0,
  "description": "5 sessions package with 10% discount"
}
```

**Response:**
```json
{
  "id": "offer123",
  "coach_id": "coach123",
  "conversation_id": "conv123",
  "status": "PENDING",
  "details": {
    "session_count": 5,
    "price_per_session": 50.0,
    "discount_percentage": 10,
    "total_price": 225.0
  }
}
```

---

### 9. Accept Custom Offer

**Endpoint:** `POST /message/custom-offer/accept`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "offer_id": "offer123",
  "conversation_id": "conv123"
}
```

**Response:**
```json
{
  "success": true,
  "booking_id": "booking789",
  "message": "Offer accepted. Payment processed.",
  "amount_paid": 225.0
}
```

---

### 10. Decline Custom Offer

**Endpoint:** `POST /message/custom-offer/decline`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "offer_id": "offer123",
  "conversation_id": "conv123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Offer declined"
}
```

---

### 11. Update Booking via Chat (Coach Only)

**Endpoint:** `POST /message/booking/update`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "booking_id": "booking789",
  "conversation_id": "conv123",
  "new_date": "2025-02-15T14:00:00Z",
  "new_time": "14:00",
  "notes": "Moved to gym location #2"
}
```

**Response:**
```json
{
  "success": true,
  "booking": {
    "id": "booking789",
    "scheduled_date": "2025-02-15T14:00:00Z",
    "notes": "Moved to gym location #2"
  }
}
```

---

## WebSocket Events (Real-Time)

### Connection Setup

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

final socket = IO.Socket(
  'https://your-backend.com',
  IO.SocketOptions(
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: Duration(milliseconds: 1000),
    reconnectionDelayMax: Duration(milliseconds: 5000),
    reconnectionAttempts: 5,
    auth: {
      'token': accessToken,
    },
  ),
);

socket.connect();

// Listen for connection events
socket.on('connect', (_) {
  print('Connected to server');
});

socket.on('disconnect', (_) {
  print('Disconnected from server');
});

socket.on('error', (data) {
  print('Connection error: $data');
});
```

---

### Event: Join Room

**Purpose:** Notify backend to track this user in a conversation room.

**Emit (From Client):**
```dart
socket.emit('joinRoom', {
  'conversation_id': 'conv123',
});
```

**Listen for Confirmation:**
```dart
socket.on('joinedRoom', (data) {
  print('Joined room: ${data['conversation_id']}');
});
```

---

### Event: Send Message (Real-Time)

**Purpose:** Broadcast a message immediately to the recipient.

**Emit (From Client):**
```dart
socket.emit('sendMessage', {
  'conversation_id': 'conv123',
  'receiver_id': 'coach123',
  'message': 'Hello, how are you?',
  'message_id': 'msg456', // Optional: for deduplication
});
```

**Listen for Delivery (Receiver Side):**
```dart
socket.on('message', (data) {
  final message = Message.fromJson(data);
  print('New message: ${message.message}');
  // Update UI with incoming message
});
```

**Typical Flow:**
1. Client A sends message via `sendMessage`
2. Server broadcasts to Client B via `message` event
3. Client B updates UI and ACKs status to `DELIVERED`

---

### Event: Update Message Status

**Purpose:** Notify when a message is delivered or read.

**Emit (From Client - After Reading):**
```dart
socket.emit('updateMessageStatus', {
  'message_id': 'msg456',
  'status': 'READ', // or 'DELIVERED'
  'conversation_id': 'conv123',
});
```

**Listen for Status Updates (Sender Side):**
```dart
socket.on('messageStatusUpdated', (data) {
  print('Message ${data['message_id']} is now ${data['status']}');
  // Update message status in UI
});
```

---

### Event: Typing Indicator

**Purpose:** Notify when user is typing.

**Emit (From Client - On Each Keystroke):**
```dart
socket.emit('typing', {
  'conversation_id': 'conv123',
  'sender_id': 'athlete123',
});
```

**Listen (Receiver Side):**
```dart
socket.on('userTyping', (data) {
  print('${data['sender_id']} is typing...');
  // Show typing indicator in UI
});
```

**Best Practice:**
- Emit `typing` event on first keystroke
- Debounce to avoid spamming (e.g., every 500ms)
- Emit `stopTyping` when user stops typing for 3 seconds

---

### Event: Stop Typing

**Purpose:** Clear typing indicator.

**Emit (From Client):**
```dart
socket.emit('stopTyping', {
  'conversation_id': 'conv123',
  'sender_id': 'athlete123',
});
```

**Listen (Receiver Side):**
```dart
socket.on('userStoppedTyping', (data) {
  print('${data["sender_id"]} stopped typing');
  // Hide typing indicator
});
```

---

### Event: User Status Change

**Purpose:** Notify when user comes online/offline.

**Automatic Event (No Emit Required):**
```dart
socket.on('userStatusChange', (data) {
  print('${data['userId']} is now ${data['status']}'); // 'online' or 'offline'
  // Update user presence in conversation list
});
```

**Event Data:**
```json
{
  "userId": "coach123",
  "status": "online",
  "timestamp": "2025-01-20T10:20:00Z"
}
```

---

## Data Models

### User Model
```json
{
  "id": "user123",
  "email": "athlete@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "user_type": "ATHLETE",
  "avatar": "https://s3.amazonaws.com/bucket/avatars/user123.jpg",
  "is_online": true,
  "created_at": "2024-01-01T00:00:00Z"
}
```

### Conversation Model
```json
{
  "id": "conv123",
  "creator_id": "athlete123",
  "participant_id": "coach123",
  "created_at": "2025-01-20T10:15:30Z",
  "updated_at": "2025-01-20T20:30:00Z",
  "last_message": {
    "message": "See you tomorrow!",
    "created_at": "2025-01-20T20:30:00Z"
  }
}
```

### Message Model
```json
{
  "id": "msg456",
  "sender_id": "athlete123",
  "receiver_id": "coach123",
  "conversation_id": "conv123",
  "message": "Can we reschedule?",
  "status": "READ",
  "attachment": null,
  "created_at": "2025-01-20T10:17:00Z",
  "updated_at": "2025-01-20T10:18:00Z"
}
```

### Attachment Model
```json
{
  "id": "att123",
  "name": "training_vid.mp4",
  "type": "video/mp4",
  "size": 5242880,
  "file": "https://s3.amazonaws.com/bucket/attachments/training_vid.mp4",
  "file_alt": "Training video",
  "format": "video",
  "duration": 120,
  "width": 1920,
  "height": 1080,
  "codec": "h264",
  "bitrate": 5000,
  "thumbnail": "https://s3.amazonaws.com/bucket/attachments/training_vid_thumb.jpg"
}
```

### MessageStatus Enum
```
PENDING   - Message sent, awaiting delivery
DELIVERED - Message received by server/recipient
READ      - Message opened by recipient
```

---

## Flutter Implementation Examples

### 1. Initialize Socket Connection

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:dio/dio.dart';

class ChatService {
  late IO.Socket socket;
  final String baseURL = 'https://your-backend.com';
  String? accessToken;

  Future<void> initializeSocket(String token) async {
    accessToken = token;
    
    socket = IO.Socket(
      baseURL,
      IO.SocketOptions(
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: Duration(milliseconds: 1000),
        reconnectionDelayMax: Duration(milliseconds: 5000),
        reconnectionAttempts: 5,
        auth: {
          'token': token,
        },
      ),
    );

    socket.connect();
    _setupListeners();
  }

  void _setupListeners() {
    socket.on('connect', (_) {
      print('✅ Connected to chat server');
    });

    socket.on('disconnect', (_) {
      print('❌ Disconnected from chat server');
    });

    socket.on('message', (data) {
      print('📨 New message: $data');
      // Handle incoming message
    });

    socket.on('userTyping', (data) {
      print('⌨️ ${data['sender_id']} is typing...');
    });

    socket.on('messageStatusUpdated', (data) {
      print('✓ Message ${data['message_id']} is ${data['status']}');
    });

    socket.on('userStatusChange', (data) {
      print('👤 ${data['userId']} is now ${data['status']}');
    });
  }

  void dispose() {
    socket.disconnect();
    socket.dispose();
  }
}
```

---

### 2. Create Conversation

```dart
import 'package:dio/dio.dart';

class ChatApi {
  final Dio dio;
  final String baseURL = 'https://your-backend.com/api/chat';
  String? accessToken;

  ChatApi({required this.dio, required this.accessToken});

  Future<Conversation> createConversation(String participantId) async {
    try {
      final response = await dio.post(
        '$baseURL/conversation/create',
        data: {
          'participant_id': participantId,
        },
        options: Options(
          headers: {
            'Authorization': 'Bearer $accessToken',
          },
        ),
      );

      return Conversation.fromJson(response.data);
    } catch (e) {
      throw 'Failed to create conversation: $e';
    }
  }

  Future<List<Conversation>> getAllConversations({int page = 1, int limit = 10}) async {
    try {
      final response = await dio.get(
        '$baseURL/conversation/all',
        queryParameters: {'page': page, 'limit': limit},
        options: Options(
          headers: {
            'Authorization': 'Bearer $accessToken',
          },
        ),
      );

      return (response.data as List)
          .map((e) => Conversation.fromJson(e))
          .toList();
    } catch (e) {
      throw 'Failed to fetch conversations: $e';
    }
  }
}
```

---

### 3. Send Message with File

```dart
Future<Message> sendMessage({
  required String receiverId,
  required String conversationId,
  String? messageText,
  File? attachmentFile,
}) async {
  try {
    FormData formData = FormData.fromMap({
      'receiver_id': receiverId,
      'conversation_id': conversationId,
      if (messageText != null) 'message': messageText,
      if (attachmentFile != null)
        'file': await MultipartFile.fromFile(
          attachmentFile.path,
          filename: attachmentFile.path.split('/').last,
        ),
    });

    final response = await dio.post(
      '$baseURL/message',
      data: formData,
      options: Options(
        headers: {
          'Authorization': 'Bearer $accessToken',
        },
      ),
    );

    return Message.fromJson(response.data);
  } catch (e) {
    throw 'Failed to send message: $e';
  }
}
```

---

### 4. Fetch Messages with Pagination

```dart
Future<MessagePage> fetchMessages({
  required String conversationId,
  int limit = 20,
  String? cursor,
}) async {
  try {
    final Map<String, dynamic> queryParams = {
      'limit': limit,
    };

    if (cursor != null) {
      queryParams['cursor'] = cursor;
    }

    final response = await dio.get(
      '$baseURL/message/$conversationId',
      queryParameters: queryParams,
      options: Options(
        headers: {
          'Authorization': 'Bearer $accessToken',
        },
      ),
    );

    final data = response.data;
    return MessagePage(
      messages: (data['data'] as List)
          .map((e) => Message.fromJson(e))
          .toList(),
      nextCursor: data['nextCursor'],
      hasMore: data['hasMore'] as bool,
    );
  } catch (e) {
    throw 'Failed to fetch messages: $e';
  }
}
```

---

### 5. Real-Time Message Handling in Provider/Riverpod

```dart
// Using Riverpod as example
final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  return ChatNotifier();
});

class ChatNotifier extends StateNotifier<ChatState> {
  late ChatService chatService;
  late ChatApi chatApi;

  ChatNotifier() : super(ChatState.initial());

  void initialize(String token) async {
    chatService = ChatService();
    chatApi = ChatApi(dio: Dio(), accessToken: token);

    await chatService.initializeSocket(token);

    // Listen for incoming messages
    chatService.socket.on('message', (data) {
      final message = Message.fromJson(data);
      state = state.copyWith(
        messages: [...state.messages, message],
      );
    });

    // Listen for typing indicators
    chatService.socket.on('userTyping', (data) {
      state = state.copyWith(
        isRecipientTyping: true,
      );
    });

    chatService.socket.on('userStoppedTyping', (data) {
      state = state.copyWith(
        isRecipientTyping: false,
      );
    });
  }

  void sendMessage(String receiverId, String conversationId, String message) {
    chatService.socket.emit('sendMessage', {
      'receiver_id': receiverId,
      'conversation_id': conversationId,
      'message': message,
    });
  }

  void markAsRead(String messageId, String conversationId) {
    chatService.socket.emit('updateMessageStatus', {
      'message_id': messageId,
      'status': 'READ',
      'conversation_id': conversationId,
    });
  }

  void emitTypingIndicator(String conversationId, String userId) {
    chatService.socket.emit('typing', {
      'conversation_id': conversationId,
      'sender_id': userId,
    });
  }

  void dispose() {
    chatService.dispose();
  }
}

class ChatState {
  final List<Message> messages;
  final bool isRecipientTyping;
  final String? error;

  ChatState({
    required this.messages,
    required this.isRecipientTyping,
    this.error,
  });

  factory ChatState.initial() =>
      ChatState(messages: [], isRecipientTyping: false);

  ChatState copyWith({
    List<Message>? messages,
    bool? isRecipientTyping,
    String? error,
  }) {
    return ChatState(
      messages: messages ?? this.messages,
      isRecipientTyping: isRecipientTyping ?? this.isRecipientTyping,
      error: error ?? this.error,
    );
  }
}
```

---

## Error Handling & Reconnection

### Handle Connection Failures

```dart
void _setupListeners() {
  socket.on('connect_error', (error) {
    print('Connection error: $error');
    // Show user notification
  });

  socket.on('error', (error) {
    print('Socket error: $error');
  });

  socket.onDisconnect((_) {
    print('Disconnected - attempting to reconnect...');
    // UI should show "Reconnecting..." indicator
  });

  socket.io.on('reconnect', (attempt) {
    print('Reconnected after $attempt attempts');
    // UI should update to show "Connected"
  });

  socket.io.on('reconnect_attempt', (attempt) {
    print('Attempting to reconnect (Attempt $attempt)');
  });

  socket.on('reconnect_error', (error) {
    print('Reconnection error: $error');
  });
}
```

### HTTP Request Error Handling

```dart
Future<Message> sendMessageWithRetry({
  required String receiverId,
  required String conversationId,
  required String messageText,
  int maxRetries = 3,
}) async {
  int attempts = 0;

  while (attempts < maxRetries) {
    try {
      return await chatApi.sendMessage(
        receiverId: receiverId,
        conversationId: conversationId,
        messageText: messageText,
      );
    } on DioException catch (e) {
      attempts++;

      if (attempts >= maxRetries) {
        if (e.type == DioExceptionType.connectionTimeout) {
          throw 'Connection timeout - check your internet';
        } else if (e.response?.statusCode == 401) {
          throw 'Session expired - please login again';
        } else if (e.response?.statusCode == 429) {
          throw 'Too many requests - please wait a moment';
        } else {
          throw 'Failed to send message: ${e.message}';
        }
      }

      // Exponential backoff
      await Future.delayed(Duration(milliseconds: 500 * attempts));
    }
  }

  throw 'Failed to send message after $maxRetries attempts';
}
```

---

## Performance Optimization

### 1. Lazy Load Messages (Infinite Scroll)

```dart
class ChatMessagesList extends StatefulWidget {
  @override
  State<ChatMessagesList> createState() => _ChatMessagesListState();
}

class _ChatMessagesListState extends State<ChatMessagesList> {
  String? nextCursor;
  bool isLoadingMore = false;

  @override
  void initState() {
    super.initState();
    _loadMessages();
  }

  void _onScroll(ScrollNotification notification) {
    if (notification is ScrollEndNotification) {
      if (_scrollController.position.extentAfter < 500) {
        _loadMoreMessages();
      }
    }
  }

  Future<void> _loadMessages() async {
    final page = await chatApi.fetchMessages(
      conversationId: widget.conversationId,
      limit: 20,
    );

    setState(() {
      messages = page.messages;
      nextCursor = page.nextCursor;
    });
  }

  Future<void> _loadMoreMessages() async {
    if (isLoadingMore || nextCursor == null) return;

    setState(() => isLoadingMore = true);

    final page = await chatApi.fetchMessages(
      conversationId: widget.conversationId,
      limit: 20,
      cursor: nextCursor,
    );

    setState(() {
      messages.addAll(page.messages);
      nextCursor = page.nextCursor;
      isLoadingMore = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: _scrollController,
      reverse: true,
      itemCount: messages.length + (isLoadingMore ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == 0 && isLoadingMore) {
          return const LoadingIndicator();
        }
        final message = messages[index - (isLoadingMore ? 1 : 0)];
        return MessageTile(message: message);
      },
    );
  }
}
```

---

### 2. Debounce Typing Indicator

```dart
Timer? _typingTimer;
bool _isTyping = false;

void _onMessageInput(String text) {
  if (text.isEmpty) {
    if (_isTyping) {
      _isTyping = false;
      chatService.socket.emit('stopTyping', {
        'conversation_id': conversationId,
        'sender_id': userId,
      });
    }
    return;
  }

  if (!_isTyping) {
    _isTyping = true;
    chatService.socket.emit('typing', {
      'conversation_id': conversationId,
      'sender_id': userId,
    });
  }

  _typingTimer?.cancel();
  _typingTimer = Timer(Duration(seconds: 3), () {
    if (_isTyping) {
      _isTyping = false;
      chatService.socket.emit('stopTyping', {
        'conversation_id': conversationId,
        'sender_id': userId,
      });
    }
  });
}

@override
void dispose() {
  _typingTimer?.cancel();
  super.dispose();
}
```

---

### 3. Cache Messages Locally

```dart
// Use Hive or Sqflite for local caching
final messagesBox = await Hive.openBox('messages');

void _cacheMessage(Message message) {
  messagesBox.add({
    'id': message.id,
    'senderId': message.senderId,
    'receiverId': message.receiverId,
    'conversationId': message.conversationId,
    'message': message.message,
    'status': message.status,
    'createdAt': message.createdAt.toIso8601String(),
  });
}

Future<List<Message>> _getLocalMessages(String conversationId) async {
  final allMessages = messagesBox.values.toList();
  return allMessages
      .where((m) => m['conversationId'] == conversationId)
      .map((m) => Message(
        id: m['id'],
        senderId: m['senderId'],
        receiverId: m['receiverId'],
        conversationId: m['conversationId'],
        message: m['message'],
        status: m['status'],
        createdAt: DateTime.parse(m['createdAt']),
      ))
      .toList();
}
```

---

## Best Practices

1. **Always Close Socket on Logout**
   ```dart
   void logout() {
     chatService.socket.disconnect();
     chatService.dispose();
   }
   ```

2. **Handle Token Refresh**
   - Regenerate JWT and reconnect if token expires
   - Implement Dio interceptor to auto-refresh tokens

3. **Validate Message Metadata**
   - Always check attachment size before upload
   - Validate message text length (max 5000 chars recommended)

4. **Update Message Status**
   - Mark as `DELIVERED` when received
   - Mark as `READ` when user opens conversation

5. **Rate Limiting**
   - Respect 429 responses from server
   - Implement exponential backoff for retries

6. **Network Resilience**
   - Store unsent messages locally
   - Retry sending when connection restored

7. **Memory Management**
   - Dispose listeners when leaving chat screen
   - Clear message cache periodically
   - Unbind Socket.io event listeners

8. **Notification Handling**
   - Show local notification on new message
   - Use push notifications for offline users
   - Mark notifications as read when user views message

---

## Troubleshooting

### Connection Refused
- Verify backend is running
- Check Authorization header format (must be `Bearer <token>`)
- Ensure token is still valid (not expired)

### Typing Indicator Not Working
- Verify `stopTyping` is emitted after inactivity
- Check that conversation_id matches server's expectation

### File Upload Fails
- Check file size (max 300MB global limit)
- Verify MIME type is supported (video, image, etc.)
- Ensure storage driver (S3/MinIO) is accessible

### Messages Not Real-Time
- Verify Socket.io connection is established (check `connect` event)
- Check that `joinRoom` was emitted for the conversation
- Verify message `conversation_id` matches room

### Reconnection Loop
- Check network status
- Verify JWT token hasn't expired
- Review backend logs for auth errors

---

## Example: Full Chat Screen

```dart
class ChatScreen extends ConsumerStatefulWidget {
  final String conversationId;
  final String participantId;

  const ChatScreen({
    required this.conversationId,
    required this.participantId,
  });

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  late TextEditingController _messageController;
  late ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _messageController = TextEditingController();
    _scrollController = ScrollController();

    // Join the room
    ref.read(chatProvider.notifier).joinRoom(widget.conversationId);
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _sendMessage() {
    if (_messageController.text.trim().isEmpty) return;

    ref.read(chatProvider.notifier).sendMessage(
      widget.participantId,
      widget.conversationId,
      _messageController.text,
    );

    _messageController.clear();
    _scrollController.animateTo(
      0,
      duration: Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(chatProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text('Chat with Coach'),
        centerTitle: true,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              reverse: true,
              itemCount: chatState.messages.length,
              itemBuilder: (context, index) {
                final message = chatState.messages[index];
                return MessageBubble(message: message);
              },
            ),
          ),
          if (chatState.isRecipientTyping)
            Padding(
              padding: EdgeInsets.all(8.0),
              child: Text('Coach is typing...', style: TextStyle(italic: true)),
            ),
          Padding(
            padding: EdgeInsets.all(16.0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    onChanged: (text) {
                      ref.read(chatProvider.notifier)
                          .emitTypingIndicator(
                            widget.conversationId,
                            userId, // current user ID
                          );
                    },
                    decoration: InputDecoration(
                      hintText: 'Type a message...',
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12),
                    ),
                  ),
                ),
                SizedBox(width: 8),
                IconButton(
                  icon: Icon(Icons.send),
                  onPressed: _sendMessage,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
```

---

## Additional Resources

- **Socket.io Flutter Client:** https://pub.dev/packages/socket_io_client
- **Dio HTTP Client:** https://pub.dev/packages/dio
- **Riverpod State Management:** https://riverpod.dev
- **Hive Local Storage:** https://pub.dev/packages/hive

---

**Questions?** Contact the backend team or review the [NestJS API Documentation](./README.md).
