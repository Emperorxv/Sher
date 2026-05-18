import { NextFunction, Request, Response } from 'express';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let mockRes: { setHeader: jest.Mock };
  let next: jest.Mock<NextFunction>;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    mockRes = { setHeader: jest.fn() };
    next = jest.fn();
  });

  it('generates an x-request-id when none is present', () => {
    const req = { headers: {} } as unknown as Request;

    middleware.use(req, mockRes as unknown as Response, next);

    expect(typeof req.headers['x-request-id']).toBe('string');
    expect((req.headers['x-request-id'] as string).length).toBeGreaterThan(0);
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', req.headers['x-request-id']);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing x-request-id from the client', () => {
    const req = {
      headers: { 'x-request-id': 'client-provided-id' },
    } as unknown as Request;

    middleware.use(req, mockRes as unknown as Response, next);

    expect(req.headers['x-request-id']).toBe('client-provided-id');
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', 'client-provided-id');
  });

  it('replaces an empty string x-request-id with a generated one', () => {
    const req = {
      headers: { 'x-request-id': '' },
    } as unknown as Request;

    middleware.use(req, mockRes as unknown as Response, next);

    expect((req.headers['x-request-id'] as string).length).toBeGreaterThan(0);
    expect(req.headers['x-request-id']).not.toBe('');
  });

  it('always calls next()', () => {
    const req = { headers: {} } as unknown as Request;
    middleware.use(req, mockRes as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
