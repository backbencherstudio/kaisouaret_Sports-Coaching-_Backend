import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { ContentService } from './content.service';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guard/role/roles.guard';
import { Roles } from '../../../../common/guard/role/roles.decorator';
import { Role } from '../../../../common/guard/role/role.enum';
import { ApproveContentDto } from './dto/approve-content.dto';
import { RejectContentDto } from './dto/reject-content.dto';

@ApiBearerAuth()
@ApiTags('Content Management')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @ApiOperation({ summary: 'Get all coaches list' })
  @Get('coaches')
  async getCoachList() {
    return this.contentService.getCoachList();
  }

  @ApiOperation({ summary: 'Get session validation list with athlete and coach matches' })
  @Get('session-validation')
  async getSessionValidationList() {
    return this.contentService.getSessionValidationList();
  }

  @ApiOperation({ summary: 'Get content approval list (pending coach profile updates)' })
  @Get('content-approval')
  async getContentApprovalList() {
    return this.contentService.getContentApprovalList();
  }

  @ApiOperation({ summary: 'Approve content (coach profile or user)' })
  @ApiBody({ type: ApproveContentDto })
  @Post('content-approval/approve')
  async approveContent(@Body() approveContentDto: ApproveContentDto) {
    return this.contentService.approveContent(
      approveContentDto.id,
      approveContentDto.type || 'coach_profile',
    );
  }

  @ApiOperation({ summary: 'Reject content (coach profile or user)' })
  @ApiBody({ type: RejectContentDto })
  @Post('content-approval/reject')
  async rejectContent(@Body() rejectContentDto: RejectContentDto) {
    return this.contentService.rejectContent(
      rejectContentDto.id,
      rejectContentDto.type,
      rejectContentDto.reason,
    );
  }
}
