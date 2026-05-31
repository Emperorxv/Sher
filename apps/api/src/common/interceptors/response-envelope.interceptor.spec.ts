import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

function makeNext(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ResponseEnvelopeInterceptor', () => {
  let interceptor: ResponseEnvelopeInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new ResponseEnvelopeInterceptor();
  });

  it('wraps a plain object in { data }', (done) => {
    interceptor
      .intercept({} as ExecutionContext, makeNext({ id: '1', name: 'test' }))
      .subscribe((result) => {
        expect(result).toEqual({ data: { id: '1', name: 'test' } });
        done();
      });
  });

  it('wraps an array in { data }', (done) => {
    interceptor.intercept({} as ExecutionContext, makeNext([1, 2, 3])).subscribe((result) => {
      expect(result).toEqual({ data: [1, 2, 3] });
      done();
    });
  });

  it('wraps null in { data }', (done) => {
    interceptor.intercept({} as ExecutionContext, makeNext(null)).subscribe((result) => {
      expect(result).toEqual({ data: null });
      done();
    });
  });

  it('wraps a string in { data }', (done) => {
    interceptor.intercept({} as ExecutionContext, makeNext('hello')).subscribe((result) => {
      expect(result).toEqual({ data: 'hello' });
      done();
    });
  });

  it('skips envelope when SkipResponseEnvelope metadata is set', (done) => {
    const mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const skippingInterceptor = new ResponseEnvelopeInterceptor(mockReflector);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    skippingInterceptor.intercept(ctx, makeNext({ id: '1' })).subscribe((result) => {
      expect(result).toEqual({ id: '1' });
      done();
    });
  });
});
