# Flutter Mobile Authentication Integration Guide

## Overview

This guide provides complete instructions for integrating Google Sign In and Apple Sign In with your NestJS backend API in a Flutter mobile application.

**Backend Endpoints:**
- `POST /auth/google/mobile` - Google OAuth authentication
- `POST /auth/apple/mobile` - Apple Sign In authentication

**Authentication Flow:**
1. User initiates social login in Flutter app
2. Flutter SDK obtains authentication token (idToken/identityToken)
3. Flutter sends token to backend API
4. Backend validates token with Google/Apple servers
5. Backend creates/updates user account
6. Backend returns JWT access & refresh tokens
7. App stores tokens for authenticated API requests

---

## Backend Environment Configuration

Before implementing Flutter integration, ensure your backend has the following environment variables configured:

### Google Authentication

```env
# Google OAuth Client IDs (from Google Cloud Console)
GOOGLE_ANDROID_APP_ID=your-android-app-id.apps.googleusercontent.com
GOOGLE_IOS_APP_ID=your-ios-app-id.apps.googleusercontent.com
GOOGLE_MOBILE_APP_IDS=additional-client-id-1,additional-client-id-2  # Optional: comma-separated list
```

**How to obtain:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select your project
3. Enable Google Sign-In API
4. Create OAuth 2.0 Client IDs for:
   - Android application (use your app's SHA-1 fingerprint)
   - iOS application (use your app's Bundle ID)

### Apple Sign In

```env
# Apple Sign In Client IDs (from Apple Developer Console)
APPLE_MOBILE_CLIENT_IDS=com.yourcompany.yourapp,com.yourcompany.yourapp.service  # Comma-separated
```

**How to obtain:**
1. Go to [Apple Developer Console](https://developer.apple.com/)
2. Create an App ID with "Sign in with Apple" capability
3. Use your app's Bundle Identifier as the client ID
4. Optionally create Service IDs for additional platforms

---

## Flutter Setup

### 1. Dependencies

Add these packages to your `pubspec.yaml`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  
  # Google Sign In
  google_sign_in: ^6.1.5
  
  # Apple Sign In (iOS only)
  sign_in_with_apple: ^5.0.0
  
  # HTTP client for API requests
  http: ^1.1.0
  
  # Secure storage for tokens
  flutter_secure_storage: ^9.0.0
  
  # Optional: State management
  provider: ^6.1.0  # or riverpod, bloc, etc.
```

Run: `flutter pub get`

### 2. Android Configuration (Google Sign In)

**File:** `android/app/build.gradle`

```gradle
android {
    defaultConfig {
        applicationId "com.yourcompany.yourapp"  // Must match Google Cloud Console
        minSdkVersion 21  // Required for Google Sign In
        // ... other config
    }
}
```

**Generate SHA-1 fingerprint** (required for Google Sign In):

```bash
# Debug SHA-1
cd android && ./gradlew signingReport

# Look for SHA-1 under "Variant: debug" and add it to Google Cloud Console
```

### 3. iOS Configuration

**File:** `ios/Runner/Info.plist`

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleTypeRole</key>
        <string>Editor</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <!-- Reverse of iOS client ID from Google Cloud Console -->
            <string>com.googleusercontent.apps.YOUR-IOS-CLIENT-ID</string>
        </array>
    </dict>
</array>

<!-- Apple Sign In Capability (if using Apple Sign In) -->
<key>com.apple.developer.applesignin</key>
<array>
    <string>Default</string>
</array>
```

**Enable Sign in with Apple** in Xcode:
1. Open `ios/Runner.xcworkspace` in Xcode
2. Select Runner target → Signing & Capabilities
3. Click "+ Capability" → Add "Sign in with Apple"

---

## Flutter Implementation

### Complete Authentication Service

Create `lib/services/auth_service.dart`:

```dart
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  // Replace with your actual backend URL
  static const String baseUrl = 'https://your-api.com';
  
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: ['email', 'profile'],
    // Optional: Add specific client IDs if needed
    // clientId: 'your-ios-client-id.apps.googleusercontent.com',
  );
  
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  // ==================== GOOGLE SIGN IN ====================
  
  /// Authenticate with Google and login to backend
  Future<AuthResponse> signInWithGoogle() async {
    try {
      // 1. Trigger Google Sign In flow
      final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
      
      if (googleUser == null) {
        throw AuthException('Google Sign In was cancelled');
      }
      
      // 2. Obtain authentication tokens
      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
      
      if (googleAuth.idToken == null) {
        throw AuthException('Failed to obtain Google ID token');
      }
      
      // 3. Send idToken to your backend
      final response = await http.post(
        Uri.parse('$baseUrl/auth/google/mobile'),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode({
          'idToken': googleAuth.idToken,
          'timezone': DateTime.now().timeZoneName, // Optional: e.g., 'UTC', 'Asia/Dhaka'
        }),
      );
      
      return _handleAuthResponse(response);
      
    } catch (e) {
      if (e is AuthException) rethrow;
      throw AuthException('Google Sign In failed: ${e.toString()}');
    }
  }

  // ==================== APPLE SIGN IN ====================
  
  /// Authenticate with Apple and login to backend
  Future<AuthResponse> signInWithApple() async {
    try {
      // Check if Apple Sign In is available (iOS 13+)
      if (!await SignInWithApple.isAvailable()) {
        throw AuthException('Apple Sign In is not available on this device');
      }
      
      // 1. Trigger Apple Sign In flow
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
      );
      
      if (credential.identityToken == null) {
        throw AuthException('Failed to obtain Apple identity token');
      }
      
      // 2. Build request payload
      final Map<String, dynamic> payload = {
        'identityToken': credential.identityToken!,
      };
      
      // Apple only provides email/name on FIRST login, so include them if available
      if (credential.email != null && credential.email!.isNotEmpty) {
        payload['email'] = credential.email;
      }
      if (credential.givenName != null && credential.givenName!.isNotEmpty) {
        payload['firstName'] = credential.givenName;
      }
      if (credential.familyName != null && credential.familyName!.isNotEmpty) {
        payload['lastName'] = credential.familyName;
      }
      
      // Optional timezone
      payload['timezone'] = DateTime.now().timeZoneName;
      
      // 3. Send identityToken to your backend
      final response = await http.post(
        Uri.parse('$baseUrl/auth/apple/mobile'),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode(payload),
      );
      
      return _handleAuthResponse(response);
      
    } catch (e) {
      if (e is AuthException) rethrow;
      throw AuthException('Apple Sign In failed: ${e.toString()}');
    }
  }

  // ==================== HELPER METHODS ====================
  
  /// Parse and validate backend authentication response
  AuthResponse _handleAuthResponse(http.Response response) {
    if (response.statusCode == 200 || response.statusCode == 201) {
      final data = jsonDecode(response.body);
      
      if (data['success'] == true && data['authorization'] != null) {
        final authResponse = AuthResponse.fromJson(data);
        
        // Store tokens securely
        _storeTokens(
          authResponse.accessToken,
          authResponse.refreshToken,
        );
        
        return authResponse;
      } else {
        throw AuthException('Invalid response format from server');
      }
    } else if (response.statusCode == 401) {
      throw AuthException('Authentication failed: Invalid token');
    } else if (response.statusCode == 409) {
      throw AuthException('Account already linked to another user');
    } else if (response.statusCode == 400) {
      final data = jsonDecode(response.body);
      throw AuthException(data['message'] ?? 'Invalid request');
    } else {
      throw AuthException('Server error: ${response.statusCode}');
    }
  }
  
  /// Store tokens in secure storage
  Future<void> _storeTokens(String accessToken, String refreshToken) async {
    await _secureStorage.write(key: 'access_token', value: accessToken);
    await _secureStorage.write(key: 'refresh_token', value: refreshToken);
  }
  
  /// Retrieve stored access token
  Future<String?> getAccessToken() async {
    return await _secureStorage.read(key: 'access_token');
  }
  
  /// Sign out (clear tokens and Google Sign In state)
  Future<void> signOut() async {
    await _secureStorage.deleteAll();
    await _googleSignIn.signOut();
  }
}

// ==================== MODELS ====================

class AuthResponse {
  final bool success;
  final String message;
  final String accessToken;
  final String refreshToken;
  final String tokenType;
  final User user;
  final String userType;

  AuthResponse({
    required this.success,
    required this.message,
    required this.accessToken,
    required this.refreshToken,
    required this.tokenType,
    required this.user,
    required this.userType,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    return AuthResponse(
      success: json['success'] ?? false,
      message: json['message'] ?? '',
      accessToken: json['authorization']['access_token'],
      refreshToken: json['authorization']['refresh_token'],
      tokenType: json['authorization']['token_type'] ?? 'Bearer',
      user: User.fromJson(json['user']),
      userType: json['type'] ?? 'STUDENT',
    );
  }
}

class User {
  final int id;
  final String name;
  final String email;
  final String? avatar;

  User({
    required this.id,
    required this.name,
    required this.email,
    this.avatar,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'],
      name: json['name'] ?? '',
      email: json['email'],
      avatar: json['avatar'],
    );
  }
}

class AuthException implements Exception {
  final String message;
  AuthException(this.message);
  
  @override
  String toString() => message;
}
```

---

## UI Implementation Example

### Login Screen with Social Auth Buttons

Create `lib/screens/login_screen.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;
import '../services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({Key? key}) : super(key: key);

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final AuthService _authService = AuthService();
  bool _isLoading = false;

  Future<void> _handleGoogleSignIn() async {
    setState(() => _isLoading = true);
    
    try {
      final authResponse = await _authService.signInWithGoogle();
      
      if (mounted) {
        // Navigate to home screen
        Navigator.pushReplacementNamed(context, '/home');
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Welcome ${authResponse.user.name}!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString()),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _handleAppleSignIn() async {
    setState(() => _isLoading = true);
    
    try {
      final authResponse = await _authService.signInWithApple();
      
      if (mounted) {
        // Navigate to home screen
        Navigator.pushReplacementNamed(context, '/home');
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Welcome ${authResponse.user.name}!')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString()),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // App Logo/Title
              const Icon(Icons.sports_tennis, size: 80, color: Colors.blue),
              const SizedBox(height: 16),
              const Text(
                'Sports Coaching',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text(
                'Sign in to continue',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, color: Colors.grey),
              ),
              const SizedBox(height: 48),
              
              // Google Sign In Button
              ElevatedButton.icon(
                onPressed: _isLoading ? null : _handleGoogleSignIn,
                icon: Image.asset('assets/google_logo.png', height: 24), // Add Google logo asset
                label: const Text('Continue with Google'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: Colors.black87,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  side: const BorderSide(color: Colors.grey),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
              
              const SizedBox(height: 16),
              
              // Apple Sign In Button (iOS only)
              if (defaultTargetPlatform == TargetPlatform.iOS)
                ElevatedButton.icon(
                  onPressed: _isLoading ? null : _handleAppleSignIn,
                  icon: const Icon(Icons.apple, size: 24),
                  label: const Text('Continue with Apple'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.black,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              
              if (_isLoading) ...[
                const SizedBox(height: 24),
                const Center(child: CircularProgressIndicator()),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
```

---

## Making Authenticated API Requests

After successful login, use the stored access token for authenticated requests:

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class ApiClient {
  static const String baseUrl = 'https://your-api.com';
  final AuthService _authService = AuthService();

  /// GET request with authentication
  Future<Map<String, dynamic>> get(String endpoint) async {
    final token = await _authService.getAccessToken();
    
    if (token == null) {
      throw Exception('Not authenticated');
    }
    
    final response = await http.get(
      Uri.parse('$baseUrl$endpoint'),
      headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
      },
    );
    
    if (response.statusCode == 401) {
      // Token expired - implement refresh token logic here
      throw Exception('Session expired, please login again');
    }
    
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Request failed: ${response.statusCode}');
    }
  }
  
  /// POST request with authentication
  Future<Map<String, dynamic>> post(String endpoint, Map<String, dynamic> body) async {
    final token = await _authService.getAccessToken();
    
    if (token == null) {
      throw Exception('Not authenticated');
    }
    
    final response = await http.post(
      Uri.parse('$baseUrl$endpoint'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: jsonEncode(body),
    );
    
    if (response.statusCode == 401) {
      throw Exception('Session expired, please login again');
    }
    
    if (response.statusCode == 200 || response.statusCode == 201) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Request failed: ${response.statusCode}');
    }
  }
}
```

---

## API Request/Response Format

### Google Sign In

**Endpoint:** `POST /auth/google/mobile`

**Request Body:**
```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE4MmE...",
  "timezone": "Asia/Dhaka"  // Optional
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logged in successfully",
  "authorization": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer"
  },
  "type": "STUDENT",
  "user": {
    "id": 123,
    "name": "John Doe",
    "email": "john@gmail.com",
    "avatar": "https://lh3.googleusercontent.com/a/..."
  }
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid or expired Google token
- `400 Bad Request`: Missing idToken or invalid format
- `409 Conflict`: Google account already linked to another user
- `500 Internal Server Error`: Server configuration issue

### Apple Sign In

**Endpoint:** `POST /auth/apple/mobile`

**Request Body:**
```json
{
  "identityToken": "eyJraWQiOiJlWGF1bm1MIiwiYWxnIjoiUlMyNTYifQ...",
  "email": "john@privaterelay.appleid.com",  // Optional: only on first login
  "firstName": "John",  // Optional: only on first login
  "lastName": "Doe",    // Optional: only on first login
  "timezone": "America/New_York"  // Optional
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logged in successfully",
  "authorization": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer"
  },
  "type": "STUDENT",
  "user": {
    "id": 124,
    "name": "John Doe",
    "email": "john@privaterelay.appleid.com",
    "avatar": null
  }
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid or expired Apple token, JWKS verification failed
- `400 Bad Request`: Missing identityToken, invalid email format
- `409 Conflict`: Apple account already linked to another user
- `500 Internal Server Error`: Apple JWKS fetch failed

---

## Backend Implementation Details

### How Token Validation Works

#### Google OAuth Validation
1. Backend receives `idToken` from Flutter
2. Backend uses `OAuth2Client.verifyIdToken()` to validate:
   - Token signature matches Google's public keys
   - Token is not expired
   - Token audience matches configured client IDs (Android/iOS/Mobile)
3. Extracts user data from verified payload:
   - `sub` → Google user ID
   - `email` → User email
   - `given_name` → First name
   - `family_name` → Last name
   - `picture` → Avatar URL

#### Apple Sign In Validation
1. Backend receives `identityToken` (JWT) from Flutter
2. Backend fetches Apple's public keys from `https://appleid.apple.com/auth/keys`
3. Backend uses `jose.jwtVerify()` to validate:
   - JWT signature matches Apple's public key
   - Issuer is `https://appleid.apple.com`
   - Audience matches configured client IDs
   - Token is not expired
4. Extracts user data from verified JWT:
   - `sub` → Apple user ID
   - `email` → User email (may be private relay)
5. **Important:** Apple only provides email/name on the FIRST authentication. Backend accepts these from request body as fallback.

### User Account Linking Strategy

Both strategies follow the same pattern:

1. **Find by Provider ID:** Check if user exists with `google_id` or `apple_id`
2. **Link by Email:** If not found, check if user exists with matching email and link provider ID
3. **Create New User:** If still not found, create new user with provider ID
4. **Return JWT:** Generate access and refresh tokens for authenticated session

This allows users to:
- Sign in with same email across Google/Apple/Email login
- Link multiple social accounts to one user account
- Seamlessly switch between authentication methods

---

## Error Handling Best Practices

### Flutter Side

```dart
try {
  final authResponse = await _authService.signInWithGoogle();
  // Success
} on AuthException catch (e) {
  // User-friendly error from backend
  print('Auth error: ${e.message}');
} on SocketException {
  // Network error
  print('No internet connection');
} on FormatException {
  // Invalid JSON response
  print('Server returned invalid data');
} catch (e) {
  // Unexpected error
  print('An unexpected error occurred: $e');
}
```

### Common Error Scenarios

| Error | Cause | Solution |
|-------|-------|----------|
| "Google Sign In was cancelled" | User closed sign-in dialog | Allow user to retry |
| "Failed to obtain Google ID token" | Network issue during Google auth | Check internet connection |
| "Authentication failed: Invalid token" | Token expired or tampered | Token expires quickly, ensure timely submission |
| "Apple Sign In is not available" | iOS < 13 or Android device | Hide Apple button on unsupported platforms |
| "Account already linked to another user" | User trying to link already-linked social account | Inform user to use original login method |
| "Server error: 500" | Backend misconfiguration (missing env vars) | Check backend logs, verify environment variables |

---

## Testing Checklist

### Google Sign In Testing

- [ ] Android device/emulator can sign in with Google
- [ ] iOS device/simulator can sign in with Google
- [ ] App receives and stores access/refresh tokens
- [ ] User data (name, email, avatar) displays correctly
- [ ] Subsequent logins work without re-entering credentials
- [ ] Sign out clears stored tokens
- [ ] Cancelling Google dialog shows appropriate message
- [ ] Network errors are handled gracefully

### Apple Sign In Testing

- [ ] iOS 13+ device/simulator can sign in with Apple
- [ ] First login captures email and name
- [ ] Subsequent logins work even though Apple doesn't send email again
- [ ] "Hide My Email" private relay emails work correctly
- [ ] User can cancel Apple dialog
- [ ] Android users don't see Apple Sign In button

### Backend Testing

- [ ] Environment variables are configured correctly
- [ ] Google token validation works (test with expired token)
- [ ] Apple token validation works (test with invalid token)
- [ ] User account is created on first social login
- [ ] User account is found/linked on subsequent logins
- [ ] Access tokens work for authenticated API requests
- [ ] Error responses return proper HTTP status codes

---

## Security Best Practices

### Flutter App

1. **Never store tokens in plain text:** Use `flutter_secure_storage` for access/refresh tokens
2. **Never log sensitive data:** Don't print idToken or accessToken to console in production
3. **Validate SSL certificates:** Ensure HTTP client validates server certificates
4. **Use HTTPS only:** Never send tokens over HTTP

### Backend API

1. **Validate every token:** Never trust client-provided user data without token validation
2. **Use environment variables:** Store client IDs and secrets in environment variables, not code
3. **Implement rate limiting:** Prevent brute force attacks on auth endpoints
4. **Short token expiry:** Access tokens should expire quickly (e.g., 15 minutes)
5. **Rotate refresh tokens:** Implement refresh token rotation for better security
6. **Log authentication attempts:** Monitor for suspicious activity

---

## Troubleshooting

### "PlatformException: sign_in_failed" (Google)

**Cause:** SHA-1 fingerprint not registered in Google Cloud Console

**Solution:**
```bash
cd android && ./gradlew signingReport
# Copy SHA-1 and add to Google Cloud Console → Credentials → OAuth 2.0 Client ID
```

### "Invalid grant: account not found" (Google)

**Cause:** Using wrong OAuth Client ID for platform

**Solution:** Verify `GOOGLE_ANDROID_APP_ID` matches Android client ID and `GOOGLE_IOS_APP_ID` matches iOS client ID in Google Cloud Console

### Apple Sign In Button Not Showing

**Cause:** Missing capability or iOS version check

**Solution:** 
- Ensure Xcode has "Sign in with Apple" capability enabled
- Wrap Apple button in platform check: `if (defaultTargetPlatform == TargetPlatform.iOS)`

### "Failed to verify Apple token" (Backend)

**Cause:** Invalid audience configuration

**Solution:** Ensure `APPLE_MOBILE_CLIENT_IDS` matches your app's Bundle Identifier exactly

### "CORS Error" When Testing

**Cause:** Backend CORS not configured for mobile requests

**Solution:** This is not an issue for mobile apps (CORS only affects browsers). If testing in web, configure CORS in NestJS:

```typescript
// main.ts
app.enableCors({
  origin: true,
  credentials: true,
});
```

---

## Advanced: Refresh Token Implementation

Implement automatic token refresh when access token expires:

```dart
class ApiClient {
  Future<String> _getValidToken() async {
    String? token = await _authService.getAccessToken();
    
    if (token == null) throw Exception('Not authenticated');
    
    // Check if token is expired (decode JWT and check 'exp' claim)
    if (_isTokenExpired(token)) {
      // Refresh token
      final refreshToken = await _secureStorage.read(key: 'refresh_token');
      token = await _refreshAccessToken(refreshToken!);
    }
    
    return token;
  }
  
  Future<String> _refreshAccessToken(String refreshToken) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/refresh'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'refresh_token': refreshToken}),
    );
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      final newAccessToken = data['authorization']['access_token'];
      await _secureStorage.write(key: 'access_token', value: newAccessToken);
      return newAccessToken;
    } else {
      throw Exception('Token refresh failed');
    }
  }
  
  bool _isTokenExpired(String token) {
    // Decode JWT and check expiration
    // Implementation depends on JWT structure
    return false; // Placeholder
  }
}
```

---

## Summary

### What You Need From Backend

✅ **Environment Variables Configured:**
- `GOOGLE_ANDROID_APP_ID`
- `GOOGLE_IOS_APP_ID`
- `APPLE_MOBILE_CLIENT_IDS`

✅ **Endpoints Deployed:**
- `POST /auth/google/mobile`
- `POST /auth/apple/mobile`

✅ **Response Format:**
- Returns `authorization.access_token` and `authorization.refresh_token`
- Returns user data: `id`, `name`, `email`, `avatar`

### What You Need From Flutter

✅ **Packages Installed:**
- `google_sign_in`
- `sign_in_with_apple`
- `http`
- `flutter_secure_storage`

✅ **Platform Configuration:**
- Android: SHA-1 fingerprint in Google Cloud Console
- iOS: Bundle ID in Apple Developer Console, URL schemes in Info.plist

✅ **Implementation:**
- Extract `idToken` from Google Sign In
- Extract `identityToken` from Apple Sign In
- Send token to backend endpoint
- Store received JWT tokens securely
- Use access token for authenticated API requests

---

## Support

For backend API issues:
- Check backend logs for detailed error messages
- Verify environment variables are set correctly
- Test endpoints with tools like Postman/Insomnia

For Flutter integration issues:
- Check Flutter console for error stack traces
- Verify Google Cloud Console and Apple Developer Console configuration
- Test on physical devices (simulators may have limitations)

---

**Last Updated:** January 2025
**Backend Version:** NestJS with Passport Custom Strategy
**Compatible Flutter SDK:** 3.0+
