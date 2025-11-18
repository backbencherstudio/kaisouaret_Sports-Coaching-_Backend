import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Express } from 'express';
import { MarketplaceManagementService } from './marketplace-management.service';
import { CreateMarketplaceManagementDto } from './dto/create-marketplace-management.dto';
import { UpdateMarketplaceManagementDto } from './dto/update-marketplace-management.dto';
import { QueryMarketplaceManagementDto } from './dto/query-marketplace-management.dto';

@Controller('marketplace-management')
export class MarketplaceManagementController {
  constructor(private readonly marketplaceManagementService: MarketplaceManagementService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
    }),
  )
  async create(
    @Body() createMarketplaceManagementDto: CreateMarketplaceManagementDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    console.log(image);
    return this.marketplaceManagementService.create(createMarketplaceManagementDto, image);
  }

  @Get()
  async findAll(@Query() query: QueryMarketplaceManagementDto) {
    return this.marketplaceManagementService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Query('includeImage') includeImage?: string) {
    const shouldIncludeImage =
      includeImage === undefined || includeImage === 'true';
    return this.marketplaceManagementService.findOne(id, shouldIncludeImage);
  }

  @Patch(':id')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
    }),
  )
  async update(
    @Param('id') id: string,
    @Body() updateMarketplaceManagementDto: UpdateMarketplaceManagementDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.marketplaceManagementService.update(id, updateMarketplaceManagementDto, image);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.marketplaceManagementService.remove(id);
  }
}
