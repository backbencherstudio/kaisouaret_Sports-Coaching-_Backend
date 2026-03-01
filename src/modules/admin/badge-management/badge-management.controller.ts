import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Express } from 'express';
import { BadgeManagementService } from './badge-management.service';
import { CreateBadgeManagementDto } from './dto/create-badge-management.dto';
import { UpdateBadgeManagementDto } from './dto/update-badge-management.dto';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Role } from 'src/common/guard/role/role.enum';
import { Roles } from 'src/common/guard/role/roles.decorator';

@ApiBearerAuth()
@ApiTags('Badge Management')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/badge-management')
export class BadgeManagementController {
  constructor(
    private readonly badgeManagementService: BadgeManagementService,
  ) {}

  @ApiOperation({ summary: 'Create a new badge' })
  @ApiConsumes('multipart/form-data')
  @Post('create')
  @UseInterceptors(
    FileInterceptor('icon', {
      storage: memoryStorage(),
    }),
  )
  async createBadge(
    @Body() createBadgeManagementDto: CreateBadgeManagementDto,
    @UploadedFile() icon?: Express.Multer.File,
  ) {
    return this.badgeManagementService.createBadge(createBadgeManagementDto, icon);
  }

  @ApiOperation({ summary: 'Get all badges' })
  @Get('all')
  async findAllBadges() {
    return this.badgeManagementService.findAllBadges();
  }

  @ApiOperation({ summary: 'Get a badge by ID' })
  @Get(':id')
  async findOneBadge(@Param('id') id: string) {
    return this.badgeManagementService.findOneBadge(id);
  }

  @ApiOperation({ summary: 'Update a badge by ID' })
  @ApiConsumes('multipart/form-data')
  @Patch(':id')
  @UseInterceptors(
    FileInterceptor('icon', {
      storage: memoryStorage(),
    }),
  )
  async updateBadge(
    @Param('id') id: string,
    @Body() updateBadgeManagementDto: UpdateBadgeManagementDto,
    @UploadedFile() icon?: Express.Multer.File,
  ) {
    return this.badgeManagementService.updateBadge(
      id,
      updateBadgeManagementDto,
      icon,
    );
  }

  @ApiOperation({ summary: 'Delete a badge by ID' })
  @Delete(':id')
  async deleteBadge(@Param('id') id: string) {
    return this.badgeManagementService.deleteBadge(id);
  }
}
