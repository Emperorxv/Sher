import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
// PatchMeDto is used as @Body() parameter type — emitDecoratorMetadata must see the real class.
// UsersService is a NestJS DI token — must be value imports, not import type.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PatchMeDto } from './dto/patch-me.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from './users.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getMe(user.id);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  patchMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: PatchMeDto) {
    return this.users.patchMe(user.id, dto);
  }
}
