import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { createZodPipe } from '../common/pipes/zod-validation.pipe';
import { CreateRoomSchema, CreateRoomInput } from './schemas/create-room.schema';
import { JoinRoomSchema, JoinRoomInput } from './schemas/join-room.schema';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  // ── POST /v1/rooms ─────────────────────────────────────────────────────────

  @Post()
  async create(
    @CurrentUser() user: User,
    @Body(createZodPipe(CreateRoomSchema)) dto: CreateRoomInput,
    @Req() req: Request,
  ) {
    const deviceCountry = (req.headers['x-device-country'] as string | undefined) ?? null;
    const ip = req.ip ?? null;
    return this.rooms.createRoom(user, dto, deviceCountry, ip);
  }

  // ── GET /v1/rooms ──────────────────────────────────────────────────────────

  @Get()
  list(@CurrentUser() user: User) {
    return this.rooms.listRooms(user.id);
  }

  // ── GET /v1/rooms/:id ──────────────────────────────────────────────────────

  @Get(':id')
  getOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.rooms.getRoom(id, user.id);
  }

  // ── PATCH /v1/rooms/:id ────────────────────────────────────────────────────

  @Patch(':id')
  patch(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { name?: string; endsAt?: string },
  ) {
    return this.rooms.patchRoom(id, user.id, {
      name: body.name,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
    });
  }

  // ── GET /v1/rooms/:id/members ──────────────────────────────────────────────

  @Get(':id/members')
  getMembers(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.rooms.getMembers(id, user.id, parseInt(page, 10), parseInt(pageSize, 10));
  }

  // ── DELETE /v1/rooms/:id/members/:userId ───────────────────────────────────

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.rooms.removeMember(id, user.id, targetUserId);
  }

  // ── POST /v1/rooms/join ────────────────────────────────────────────────────

  @Post('join')
  join(@CurrentUser() user: User, @Body(createZodPipe(JoinRoomSchema)) dto: JoinRoomInput) {
    return this.rooms.joinRoom(user, dto);
  }

  // ── POST /v1/rooms/:id/end ─────────────────────────────────────────────────

  @Post(':id/end')
  endRoom(@CurrentUser() user: User, @Param('id') id: string) {
    return this.rooms.endRoom(id, user.id);
  }

  // ── GET /v1/rooms/:id/pricing ──────────────────────────────────────────────

  @Get(':id/pricing')
  pricing(@CurrentUser() user: User, @Param('id') id: string) {
    return this.rooms.getRoomPricing(id, user.id);
  }
}
