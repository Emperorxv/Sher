import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PatchMeDto } from './dto/patch-me.dto';
import type { UsersService } from './users.service';

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
