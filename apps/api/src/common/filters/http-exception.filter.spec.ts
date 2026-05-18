import { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(mockResponse: Partial<Response>): ArgumentsHost {
  return {
    switchToHttp: jest.fn().mockReturnValue({
      getResponse: jest.fn().mockReturnValue(mockResponse),
      getRequest: jest.fn().mockReturnValue({}),
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('handles HttpException with a string message', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Not found' },
    });
  });

  it('handles NotFoundException (NestJS built-in)', () => {
    const exception = new NotFoundException('Room not found');
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    const payload = mockResponse.json.mock.calls[0][0] as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('NOT_FOUND');
    expect(payload.error.message).toBe('Room not found');
  });

  it('handles UnauthorizedException', () => {
    const exception = new UnauthorizedException();
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    const { error } = mockResponse.json.mock.calls[0][0] as {
      error: { code: string };
    };
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('handles ValidationPipe errors (array message)', () => {
    const exception = new BadRequestException({
      message: ['name must be a string', 'phone must match E.164'],
      error: 'Bad Request',
    });
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: ['name must be a string', 'phone must match E.164'],
      },
    });
  });

  it('preserves custom code from exception body', () => {
    const exception = new HttpException(
      { code: 'ROOM_FULL', message: 'The room is at capacity' },
      HttpStatus.CONFLICT,
    );
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'ROOM_FULL', message: 'The room is at capacity' },
    });
  });

  it('includes details when present in exception body', () => {
    const exception = new ServiceUnavailableException({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Dependency unhealthy',
      details: { database: 'error' },
    });
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    expect(mockResponse.status).toHaveBeenCalledWith(503);
    const { error } = mockResponse.json.mock.calls[0][0] as {
      error: { code: string; message: string; details: unknown };
    };
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.details).toEqual({ database: 'error' });
  });

  it('omits details key when details is undefined', () => {
    const exception = new NotFoundException();
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    const { error } = mockResponse.json.mock.calls[0][0] as {
      error: Record<string, unknown>;
    };
    expect('details' in error).toBe(false);
  });

  it('maps 429 to RATE_LIMITED', () => {
    const exception = new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    const { error } = mockResponse.json.mock.calls[0][0] as {
      error: { code: string };
    };
    expect(error.code).toBe('RATE_LIMITED');
  });

  it('maps unknown status to HTTP_ERROR', () => {
    const exception = new HttpException('Something weird', 418);
    filter.catch(exception, makeHost(mockResponse as unknown as Response));

    const { error } = mockResponse.json.mock.calls[0][0] as {
      error: { code: string };
    };
    expect(error.code).toBe('HTTP_ERROR');
  });
});
