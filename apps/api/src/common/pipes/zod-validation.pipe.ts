import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef, ZodError } from 'zod';

/**
 * Creates a NestJS PipeTransform that validates and parses the incoming value
 * against a Zod schema. On failure it throws a 400 BadRequestException with
 * the first Zod error message.
 *
 * Usage:
 *   @Body(new ZodValidationPipe(CreateRoomSchema)) dto: CreateRoomDto
 */
export function createZodPipe<O, D extends ZodTypeDef = ZodTypeDef, I = unknown>(
  schema: ZodType<O, D, I>,
): PipeTransform {
  return {
    transform(value: unknown): O {
      const result = schema.safeParse(value);
      if (!result.success) {
        const first = (result.error as ZodError).errors[0];
        throw new BadRequestException(
          first ? `${first.path.join('.')}: ${first.message}` : 'Validation failed',
        );
      }
      return result.data;
    },
  };
}
