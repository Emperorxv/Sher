import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { createZodPipe } from '../common/pipes/zod-validation.pipe';
import { PhotosService } from './photos.service';
import { UploadUrlSchema, UploadUrlInput } from './schemas/upload-url.schema';

@Controller('rooms/:id/photos')
@UseGuards(JwtAuthGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  // ── POST /v1/rooms/:id/photos/upload-url ───────────────────────────────────

  @Post('upload-url')
  getUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roomId: string,
    @Body(createZodPipe(UploadUrlSchema)) dto: UploadUrlInput,
  ) {
    return this.photos.getUploadUrl(roomId, user.id, dto);
  }

  // ── POST /v1/rooms/:id/photos/:photoId/commit ──────────────────────────────

  @Post(':photoId/commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roomId: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photos.commit(roomId, photoId, user.id);
  }

  // ── GET /v1/rooms/:id/photos ───────────────────────────────────────────────

  @Get()
  listPhotos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roomId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('scope') rawScope?: string,
  ) {
    const scope = rawScope === 'mine' ? 'mine' : 'all';
    return this.photos.listPhotos(
      roomId,
      user.id,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
      scope,
    );
  }

  // ── GET /v1/rooms/:id/photos/:photoId ─────────────────────────────────────

  @Get(':photoId')
  getPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roomId: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photos.getPhoto(roomId, photoId, user.id);
  }

  // ── DELETE /v1/rooms/:id/photos/:photoId ───────────────────────────────────

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roomId: string,
    @Param('photoId') photoId: string,
  ) {
    await this.photos.deletePhoto(roomId, user.id, photoId);
  }
}
