import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';


@Catch()
export class CustomExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CustomExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    const timestamp = new Date().toISOString();
    const path = request.url;
    const method = request.method;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errors: any = undefined;

    // Handle HttpException (most NestJS exceptions)
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        // Handle validation errors (class-validator)
        const response: any = exceptionResponse;
        message = response.message || response.error || 'Request validation failed';
        
        // If message is an array (validation errors), keep it as array
        if (Array.isArray(response.message)) {
          errors = response.message;
          message = 'Validation failed';
        }
      }
    } 
    // Handle Prisma errors
    else if (exception && typeof exception === 'object' && 'code' in exception) {
      const prismaError: any = exception;
      const { status: prismaStatus, message: prismaMessage } = this.handlePrismaError(prismaError);
      status = prismaStatus;
      message = prismaMessage;
    }
    // Handle generic Error instances
    else if (exception instanceof Error) {
      message = exception.message;
      
      // Log stack trace for debugging in development
      if (process.env.NODE_ENV !== 'production') {
        this.logger.error(exception.stack);
      }
    }

    // Log error for monitoring
    this.logger.error(
      `${method} ${path} - ${status} - ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // Build standardized error response (matches ApiResponse interface)
    const errorResponse = {
      success: false,
      statusCode: status,
      message,
      ...(errors && { errors }), // Include validation errors if present
      // timestamp,
      // path,
      // method,
    };

    response.status(status).json(errorResponse);
  }

  /**
   * Handle Prisma database errors with appropriate HTTP status codes
   */
  private handlePrismaError(error: any): { status: number; message: string } {
    const code = error.code;

    switch (code) {
      case 'P2002': // Unique constraint violation
        return {
          status: HttpStatus.CONFLICT,
          message: `Duplicate entry: ${this.extractPrismaTarget(error)} already exists`,
        };

      case 'P2025': // Record not found
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
        };

      case 'P2003': // Foreign key constraint violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Invalid reference: related record does not exist',
        };

      case 'P2014': // Invalid ID
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Invalid ID format',
        };

      case 'P2021': // Table does not exist
      case 'P2022': // Column does not exist
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database schema error',
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database operation failed',
        };
    }
  }

  /**
   * Extract field name from Prisma error metadata
   */
  private extractPrismaTarget(error: any): string {
    try {
      if (error.meta && error.meta.target) {
        return Array.isArray(error.meta.target) 
          ? error.meta.target.join(', ') 
          : error.meta.target;
      }
    } catch (e) {
      // Ignore extraction errors
    }
    return 'Field';
  }
}
