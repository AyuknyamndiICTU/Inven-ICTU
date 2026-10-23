import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, Errors } from './problem';

export function zodToProblemErrors(e: ZodError) {
  return e.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

/** Maps every error to RFC 9457 problem+json. Internal details never leak to clients (I4). */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return Errors.validation(zodToProblemErrors(error));
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002')
      return Errors.conflict('ALREADY_EXISTS', 'A record with the same unique value already exists.');
    if (error.code === 'P2025') return Errors.notFound('The record');
    if (error.code === 'P2003')
      return Errors.conflict('REFERENCE_CONFLICT', 'A related record is missing or still in use.');
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 404) return new AppError(404, 'ROUTE_NOT_FOUND', 'Not found', 'No such endpoint.');
    if (status === 413) return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large', 'The upload is too large.');
    if (status === 415) return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type', error.message);
    if (status === 400) return Errors.badRequest('BAD_REQUEST', 'The request could not be parsed.');
    return new AppError(status, 'HTTP_ERROR', error.message, undefined);
  }
  const fastifyCode = (error as { statusCode?: number; code?: string })?.statusCode;
  if (fastifyCode === 413)
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large', 'The upload is too large.');
  if (fastifyCode === 415)
    return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type', 'Unsupported content type.');
  if (fastifyCode === 400) return Errors.badRequest('BAD_REQUEST', 'The request could not be parsed.');
  return new AppError(500, 'INTERNAL', 'Internal error', 'Something went wrong. The problem has been logged.');
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');
  constructor(@Inject('LOG_INTERNAL_ERRORS') private readonly logInternal: boolean) {}

  catch(error: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw error;
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const appError = toAppError(error);
    if (appError.status >= 500 && this.logInternal) {
      // Log the error class and message only; request bodies are never logged (I4).
      const e = error as Error;
      this.logger.error(`${req.method} ${req.routeOptions?.url ?? '?'} → ${e?.name}: ${e?.message}`);
    }
    for (const [k, v] of Object.entries(appError.headers ?? {})) reply.header(k, v);
    void reply
      .status(appError.status)
      .header('Content-Type', 'application/problem+json')
      .send(appError.toProblem(req.url.split('?')[0]));
  }
}
