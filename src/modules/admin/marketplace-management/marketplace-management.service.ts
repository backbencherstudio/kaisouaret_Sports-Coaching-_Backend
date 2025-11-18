import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, MarketplaceProduct } from '@prisma/client';
import { Express } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateMarketplaceManagementDto } from './dto/create-marketplace-management.dto';
import { UpdateMarketplaceManagementDto } from './dto/update-marketplace-management.dto';
import { QueryMarketplaceManagementDto } from './dto/query-marketplace-management.dto';
import { SazedStorage } from '../../../common/lib/Disk/SazedStorage';
import appConfig from '../../../config/app.config';
import { StringHelper } from '../../../common/helper/string.helper';

@Injectable()
export class MarketplaceManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createMarketplaceManagementDto: CreateMarketplaceManagementDto, image?: Express.Multer.File) {
    const stockQuantity = this.coerceInt(createMarketplaceManagementDto.stockQuantity);
    const price = this.toDecimal(createMarketplaceManagementDto.price);
    const discount = this.toDecimal(createMarketplaceManagementDto.discount);
    const isActive = this.coerceBoolean(createMarketplaceManagementDto.isActive, true);

    const productData: any = {
      name: createMarketplaceManagementDto.productName,
      category: createMarketplaceManagementDto.categoryId,
      price,
      stock_quantity: stockQuantity ?? 0,
      brand_seller: createMarketplaceManagementDto.brandSeller,
      discount,
      description: createMarketplaceManagementDto.description,
      is_active: isActive ?? true,
    };
    if (image?.buffer) {
      try {
        const fileName = `${StringHelper.randomString()}${image.originalname}`;
        await SazedStorage.put(
          appConfig().storageUrl.photo + '/' + fileName,
          image.buffer,
        );
        console.log("fileName: ", fileName);
        productData.image = fileName;
      } catch (error) {
        console.error('Failed to upload image:', error);
        throw new Error(`Failed to upload image: ${error.message}`);
      }
    } else if (createMarketplaceManagementDto.image) {
      productData.image = createMarketplaceManagementDto.image;
    }

    const product = await this.prisma.marketplaceProduct.create({
      data: productData,
    });

    return {
      success: true,
      data: this.serializeProduct(product, true), 
    };
  }

  async findAll(query: QueryMarketplaceManagementDto) {
    const {
      search,
      categoryId,
      isActive,
      page = 1,
      limit = 10,
      includeImage = true,
    } = query;

    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);

    const where: Prisma.MarketplaceProductWhereInput = {
      deleted_at: null,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { brand_seller: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId) {
      where.category = categoryId;
    }

    if (typeof isActive === 'boolean') {
      where.is_active = isActive;
    }

    const skip = (normalizedPage - 1) * normalizedLimit;

    const [products, total] = await Promise.all([
      this.prisma.marketplaceProduct.findMany({
        where,
        orderBy: {
          created_at: 'desc',
        },
        skip,
        take: normalizedLimit,
      }),
      this.prisma.marketplaceProduct.count({ where }),
    ]);

    const totalPages = Math.max(Math.ceil(total / normalizedLimit), 1);

    return {
      success: true,
      data: products.map((product) =>
        this.serializeProduct(product, includeImage),
      ),
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        total_pages: totalPages,
        has_next_page: normalizedPage < totalPages,
        has_previous_page: normalizedPage > 1,
      },
    };
  }

  async findOne(id: string, includeImage: boolean = true) {
    const product = await this.prisma.marketplaceProduct.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      success: true,
      data: this.serializeProduct(product, includeImage), 
    };
  }

  async update(
    id: string,
    updateMarketplaceManagementDto: UpdateMarketplaceManagementDto,
    image?: Express.Multer.File,
  ) {
    await this.ensureProductExists(id);

    const price = this.toDecimal(updateMarketplaceManagementDto.price);
    const discount = this.toDecimal(updateMarketplaceManagementDto.discount);
    const stockQuantity = this.coerceInt(updateMarketplaceManagementDto.stockQuantity);
    const isActive = this.coerceBoolean(updateMarketplaceManagementDto.isActive);

    const updateData: any = {};

    if (updateMarketplaceManagementDto.productName !== undefined) {
      updateData.name = updateMarketplaceManagementDto.productName;
    }
    if (updateMarketplaceManagementDto.categoryId !== undefined) {
      updateData.category = updateMarketplaceManagementDto.categoryId;
    }
    if (price !== undefined) {
      updateData.price = price;
    }
    if (stockQuantity !== undefined) {
      updateData.stock_quantity = stockQuantity;
    }
    if (updateMarketplaceManagementDto.brandSeller !== undefined) {
      updateData.brand_seller = updateMarketplaceManagementDto.brandSeller;
    }
    if (discount !== undefined) {
      updateData.discount = discount;
    }
    if (updateMarketplaceManagementDto.description !== undefined) {
      updateData.description = updateMarketplaceManagementDto.description;
    }
    if (isActive !== undefined) {
      updateData.is_active = isActive;
    }
    if (image?.buffer) {
      try {
        const existingProduct = await this.prisma.marketplaceProduct.findFirst({
          where: { id },
        });
        if (existingProduct?.image) {
          try {
            await SazedStorage.delete(
              appConfig().storageUrl.photo + '/' + existingProduct.image,
            );
          } catch (deleteError) {
            console.warn('Failed to delete old image:', deleteError);
          }
        }
        const fileName = `${StringHelper.randomString()}${image.originalname}`;
        await SazedStorage.put(
          appConfig().storageUrl.photo + '/' + fileName,
          image.buffer,
        );
        updateData.image = fileName;
        console.log(`Image updated successfully: ${fileName}`);
      } catch (error) {
        console.error('Failed to upload image:', error);
        throw new Error(`Failed to upload image: ${error.message}`);
      }
    } else if (updateMarketplaceManagementDto.image !== undefined) {
      updateData.image = updateMarketplaceManagementDto.image;
    }

    const product = await this.prisma.marketplaceProduct.update({
      where: { id },
      data: updateData,
    });

    return {
      success: true,
      data: this.serializeProduct(product, true),
    };
  }

  async remove(id: string) {
    await this.ensureProductExists(id);
    await this.prisma.marketplaceProduct.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });

    return {
      success: true,
      message: 'Product removed successfully',
    };
  }

  private toDecimal(value?: number | string | null) {
    const numericValue = this.coerceNumber(value);
    if (numericValue === undefined) {
      return undefined;
    }
    return new Prisma.Decimal(numericValue);
  }

  private async ensureProductExists(id: string) {
    const exists = await this.prisma.marketplaceProduct.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!exists) {
      throw new NotFoundException('Product not found');
    }
  }

  private serializeProduct(product: MarketplaceProduct, includeImage: boolean = true) {
    const serialized: any = {
      id: product.id,
      productName: product.name,
      categoryId: product.category,
      price: product.price ? Number(product.price) : 0,
      stockQuantity: product.stock_quantity,
      brandSeller: product.brand_seller,
      discount: product.discount ? Number(product.discount) : 0,
      description: product.description,
      isActive: product.is_active,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    };

    if (includeImage) {
      if (product.image) {
        if (product.image.startsWith('data:') && product.image.length > 1000) {
          serialized.hasImage = true;
          serialized.image = null; 
        } else if (product.image.startsWith('http://') || product.image.startsWith('https://')) {
          serialized.image = product.image;
        } else {
          serialized.image = SazedStorage.url(appConfig().storageUrl.photo + '/' + product.image);
        }
      } else {
        serialized.image = null;
      }
    } else {
      serialized.hasImage = !!product.image;
    }

    return serialized;
  }

  private coerceNumber(value?: number | string | null) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value === 'number') {
      return value;
    }
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private coerceInt(value?: number | string | null) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value === 'number') {
      return Math.trunc(value);
    }
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private coerceBoolean(value?: boolean | string | number | null, defaultValue?: boolean) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    const normalized = value.toString().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
    return defaultValue;
  }
}
