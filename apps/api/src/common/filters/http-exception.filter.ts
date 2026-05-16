import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

function statusToCode(status: number): string {
  const map: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
    [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  };
  return map[status] ?? 'HTTP_ERROR';
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    let code: string;
    let message: string;
    let details: unknown;

    if (typeof body === 'string') {
      code = statusToCode(status);
      message = body;
    } else {
      const bodyObj = body as Record<string, unknown>;

      if (Array.isArray(bodyObj['message'])) {
        // NestJS ValidationPipe produces { message: string[], error: string }
        code = 'VALIDATION_ERROR';
        message = 'Validation failed';
        details = bodyObj['message'];
      } else {
        // Only use a custom code when the caller explicitly sets it (not the
        // NestJS-generated "error" field which contains the HTTP status text).
        code = (bodyObj['code'] as string) ?? statusToCode(status);
        message = (bodyObj['message'] as string) ?? exception.message;
        details = bodyObj['details'];
      }
    }

    const errorBody: Record<string, unknown> = { code, message };
    if (details !== undefined) {
      errorBody['details'] = details;
    }

    response.status(status).json({ error: errorBody });
  }
}
