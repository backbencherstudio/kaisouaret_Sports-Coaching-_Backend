import { CallHandler, ExecutionContext, HttpStatus } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { HttpResponseInterceptor } from './http-response.interceptor';

function createMockContext(method: string, url = '/api/test', statusCode = 200) {
  const response: any = {
    statusCode,
    status: jest.fn().mockImplementation(function (code: number) {
      this.statusCode = code;
      return this;
    }),
  };

  const request: any = {
    method,
    url,
  };

  const context: Partial<ExecutionContext> = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  };

  return { context: context as ExecutionContext, request, response };
}

describe('HttpResponseInterceptor', () => {
  it('preserves empty array response as data: []', async () => {
    const interceptor = new HttpResponseInterceptor();
    const { context } = createMockContext('GET');
    const next: CallHandler = { handle: () => of([]) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result.statusCode).toBe(HttpStatus.OK);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('preserves non-empty array response as data array', async () => {
    const interceptor = new HttpResponseInterceptor();
    const { context } = createMockContext('GET');
    const next: CallHandler = { handle: () => of([{ a: 1 }]) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result.data).toEqual([{ a: 1 }]);
  });
});
