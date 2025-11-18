import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
import { MarketplaceManagementService } from './marketplace-management.service';
import { CreateMarketplaceManagementDto } from './dto/create-marketplace-management.dto';
import { UpdateMarketplaceManagementDto } from './dto/update-marketplace-management.dto';

@Controller('marketplace-management')
export class MarketplaceManagementController {
  constructor(private readonly marketplaceManagementService: MarketplaceManagementService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Body() createMarketplaceManagementDto: CreateMarketplaceManagementDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.marketplaceManagementService.create(createMarketplaceManagementDto, image);
  }

  @Get()
  async findAll() {
    return this.marketplaceManagementService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.marketplaceManagementService.findOne(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('image'))
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
