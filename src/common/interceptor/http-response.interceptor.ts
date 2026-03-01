import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';

/**
 * Standard API response interface
 */
export interface ApiResponse<T = any> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
}

@Injectable()
export class HttpResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  private readonly logger = new Logger(HttpResponseInterceptor.name);

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const method = request.method;
    const path = request.url;
    const timestamp = new Date().toISOString();

    return next.handle().pipe(
      map((data) => {
        // Determine appropriate status code
        const statusCode = this.determineStatusCode(
          method,
          response.statusCode,
          data,
        );

        // Set the HTTP status code on the response
        response.status(statusCode);

        // Extract message from response data
        const message = this.extractMessage(data, method);

        // Build standardized response
        const apiResponse: ApiResponse<T> = {
          success: this.isSuccessStatusCode(statusCode),
          statusCode,
          message,
          data: this.extractData(data),
        };

        // Log successful responses in production
        if (process.env.NODE_ENV === 'production' && apiResponse.success) {
          this.logger.log(`${method} ${path} - ${statusCode} - ${message}`);
        }

        return apiResponse;
      }),
    );
  }

  /**
   * Determine the appropriate HTTP status code based on:
   * - Response success field (if success: false, return error status)
   * - HTTP method (POST creates = 201, GET = 200, DELETE = 200/204)
   * - Current response status code
   * - Response data content
   */
  private determineStatusCode(
    method: string,
    currentStatusCode: number,
    data: any,
  ): number {
    // If status code was explicitly set by controller, respect it
    if (currentStatusCode !== HttpStatus.OK && currentStatusCode !== 200) {
      return currentStatusCode;
    }

    // Check if response has success: false and map to appropriate error status code
    if (data && typeof data === 'object' && 'success' in data && !data.success) {
      return this.getErrorStatusCode(data.message);
    }

    // Check if data explicitly contains statusCode
    if (data && typeof data === 'object' && 'statusCode' in data) {
      return data.statusCode;
    }

    // Method-based status code determination
    switch (method.toUpperCase()) {
      case 'POST':
        // POST requests that create resources should return 201
        if (this.isCreationOperation(data)) {
          return HttpStatus.CREATED; // 201
        }
        return HttpStatus.OK; // 200 for other POST operations (login, etc.)

      case 'DELETE':
        // DELETE can return 200 (with content) or 204 (no content)
        if (
          !data ||
          (typeof data === 'object' && Object.keys(data).length === 0)
        ) {
          return HttpStatus.NO_CONTENT; // 204
        }
        return HttpStatus.OK; // 200

      case 'PUT':
      case 'PATCH':
        // Update operations
        return HttpStatus.OK; // 200

      case 'GET':
      default:
        // GET and other operations
        return HttpStatus.OK; // 200
    }
  }

  /**
   * Map error message to appropriate HTTP status code
   */
  private getErrorStatusCode(message: string): number {
    if (!message || typeof message !== 'string') {
      return HttpStatus.BAD_REQUEST; // 400
    }

    const lowerMessage = message.toLowerCase();

    // 404 Not Found
    if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
      return HttpStatus.NOT_FOUND;
    }

    // 401 Unauthorized - authentication failures
    if (
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('invalid token') ||
      lowerMessage.includes('token expired') ||
      lowerMessage.includes('invalid password') ||
      lowerMessage.includes('password incorrect') ||
      lowerMessage.includes('current password is incorrect') ||
      lowerMessage.includes('email not found')
    ) {
      return HttpStatus.UNAUTHORIZED;
    }

    // 403 Forbidden - authorization failures
    if (
      lowerMessage.includes('forbidden') ||
      lowerMessage.includes('access denied') ||
      lowerMessage.includes('permission denied') ||
      lowerMessage.includes('not allowed')
    ) {
      return HttpStatus.FORBIDDEN;
    }

    // 409 Conflict - resource already exists
    if (
      lowerMessage.includes('conflict') ||
      lowerMessage.includes('already exists') ||
      lowerMessage.includes('duplicate') ||
      lowerMessage.includes('email already')
    ) {
      return HttpStatus.CONFLICT;
    }

    // Default to 400 Bad Request for all other failures
    return HttpStatus.BAD_REQUEST;
  }

  /**
   * Check if the operation is a creation operation
   * by analyzing the response data structure
   */
  private isCreationOperation(data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check for common creation indicators
    const indicators = [
      'id' in data && !('items' in data), // Single resource with ID (not a list)
      'createdAt' in data && !('items' in data),
      'created' in data && data.created === true,
      data.message?.toLowerCase().includes('created'),
      data.message?.toLowerCase().includes('registered'),
      data.message?.toLowerCase().includes('setup'),
    ];

    return indicators.some((indicator) => indicator);
  }

  /**
   * Extract meaningful message from response data
   */
  private extractMessage(data: any, method: string): string {
    // If data has explicit message property
    if (data && typeof data === 'object' && 'message' in data) {
      return data.message;
    }

    // Default messages based on HTTP method
    const defaultMessages: Record<string, string> = {
      GET: 'Data retrieved successfully',
      POST: 'Operation completed successfully',
      PUT: 'Resource updated successfully',
      PATCH: 'Resource updated successfully',
      DELETE: 'Resource deleted successfully',
    };

    return (
      defaultMessages[method.toUpperCase()] || 'Request processed successfully'
    );
  }

  /**
   * Extract actual data payload from response
   * Removes metadata fields to keep data clean
   */
  private extractData(data: any): any {
    if (!data) {
      return undefined;
    }

    // If data is primitive (string, number, boolean), return as-is
    if (typeof data !== 'object') {
      return data;
    }

    // Preserve arrays as-is (including empty arrays)
    if (Array.isArray(data)) {
      return data;
    }

    // If data already has a 'data' property, use it and preserve important metadata
    if ('data' in data && data.data !== undefined) {
      const result: any = data.data;

      // Preserve important metadata fields
      if ('summary' in data && data.summary !== undefined) {
        return { data: result, summary: data.summary };
      }

      if ('pagination' in data && data.pagination !== undefined) {
        return { data: result, pagination: data.pagination };
      }

      return result;
    }

    // Create a clean copy without metadata fields
    const {
      message,
      statusCode,
      success,
      timestamp,
      path,
      method,
      ...cleanData
    } = data;

    // If cleanData is empty object, return undefined
    if (Object.keys(cleanData).length === 0) {
      return undefined;
    }

    // If cleanData has only one property, unwrap it
    const keys = Object.keys(cleanData);
    if (keys.length === 1 && keys[0] !== 'items' && keys[0] !== 'results') {
      // Don't unwrap common collection property names
      return cleanData;
    }

    return cleanData;
  }

  /**
   * Check if status code represents success
   */
  private isSuccessStatusCode(statusCode: number): boolean {
    return statusCode >= 200 && statusCode < 300;
  }
}
