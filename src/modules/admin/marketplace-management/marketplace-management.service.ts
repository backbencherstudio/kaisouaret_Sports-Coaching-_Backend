import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, MarketplaceProduct } from '@prisma/client';
import { Express } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateMarketplaceManagementDto } from './dto/create-marketplace-management.dto';
import { UpdateMarketplaceManagementDto } from './dto/update-marketplace-management.dto';

@Injectable()
export class MarketplaceManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createMarketplaceManagementDto: CreateMarketplaceManagementDto, image?: Express.Multer.File) {
    const stockQuantity = this.coerceInt(createMarketplaceManagementDto.stockQuantity);
    const price = this.toDecimal(createMarketplaceManagementDto.price);
    const discount = this.toDecimal(createMarketplaceManagementDto.discount);
    const isActive = this.coerceBoolean(createMarketplaceManagementDto.isActive, true);

    const product = await this.prisma.marketplaceProduct.create({
      data: {
        name: createMarketplaceManagementDto.productName,
        category: createMarketplaceManagementDto.categoryId,
        price,
        stock_quantity: stockQuantity ?? 0,
        brand_seller: createMarketplaceManagementDto.brandSeller,
        discount,
        description: createMarketplaceManagementDto.description,
        is_active: isActive ?? true,
        image_name: image?.originalname,
        image_mime: image?.mimetype,
        image_size: image?.size,
        image_data: image?.buffer,
      },
    });

    return {
      success: true,
      data: this.serializeProduct(product),
    };
  }

  async findAll() {
    const products = await this.prisma.marketplaceProduct.findMany({
      where: {
        deleted_at: null,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return {
      success: true,
      data: products.map((product) => this.serializeProduct(product)),
      total: products.length,
    };
  }

  async findOne(id: string) {
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
      data: this.serializeProduct(product),
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

    const product = await this.prisma.marketplaceProduct.update({
      where: { id },
      data: {
        ...(updateMarketplaceManagementDto.productName !== undefined && {
          name: updateMarketplaceManagementDto.productName,
        }),
        ...(updateMarketplaceManagementDto.categoryId !== undefined && {
          category: updateMarketplaceManagementDto.categoryId,
        }),
        ...(price !== undefined && { price }),
        ...(stockQuantity !== undefined && { stock_quantity: stockQuantity }),
        ...(updateMarketplaceManagementDto.brandSeller !== undefined && {
          brand_seller: updateMarketplaceManagementDto.brandSeller,
        }),
        ...(discount !== undefined && { discount }),
        ...(updateMarketplaceManagementDto.description !== undefined && {
          description: updateMarketplaceManagementDto.description,
        }),
        ...(isActive !== undefined && { is_active: isActive }),
        ...(image && {
          image_name: image.originalname,
          image_mime: image.mimetype,
          image_size: image.size,
          image_data: image.buffer,
        }),
      },
    });

    return {
      success: true,
      data: this.serializeProduct(product),
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

  private serializeProduct(product: MarketplaceProduct) {
    return {
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
      image: product.image_data
        ? {
            filename: product.image_name,
            mimeType: product.image_mime,
            size: product.image_size,
            base64: Buffer.from(product.image_data).toString('base64'),
          }
        : null,
    };
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
