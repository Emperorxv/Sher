import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { createZodPipe } from '../common/pipes/zod-validation.pipe';
import { CreateReportSchema, CreateReportInput } from './schemas/create-report.schema';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // ── POST /v1/reports ────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(createZodPipe(CreateReportSchema)) dto: CreateReportInput,
  ) {
    return this.reports.createReport(user.id, dto);
  }
}
