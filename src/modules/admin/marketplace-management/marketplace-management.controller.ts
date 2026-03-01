import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Express } from 'express';
import { MarketplaceManagementService } from './marketplace-management.service';
import { CreateMarketplaceManagementDto } from './dto/create-marketplace-management.dto';
import { UpdateMarketplaceManagementDto } from './dto/update-marketplace-management.dto';
import { QueryMarketplaceManagementDto } from './dto/query-marketplace-management.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { GetUser } from 'src/modules/auth/decorators/get-user.decorator';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiTags('Marketplace Management')
@Controller('marketplace-management')
export class MarketplaceManagementController {
  constructor(
    private readonly marketplaceManagementService: MarketplaceManagementService,
  ) {}

  @ApiOperation({ summary: 'Create a new product' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Post('product/create')
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      storage: memoryStorage(),
    }),
  )
  async createProduct(
    @Body() createMarketplaceManagementDto: CreateMarketplaceManagementDto,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    console.log(images);
    return this.marketplaceManagementService.createProduct(
      createMarketplaceManagementDto,
      images,
    );
  }

  @ApiOperation({ summary: 'Get all products' })
  @Get('products')
  async findAll(@Query() query: QueryMarketplaceManagementDto) {
    return this.marketplaceManagementService.findAll(query);
  }

  @ApiOperation({ summary: 'Get a product by ID' })
  @Get('product/:id')
  async findOne(
    @Param('id') id: string,
    @Query('includeImage') includeImage?: string,
  ) {
    const shouldIncludeImage =
      includeImage === undefined || includeImage === 'true';
    return this.marketplaceManagementService.findOne(id, shouldIncludeImage);
  }

  @ApiOperation({ summary: 'Update a product' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('product/:id')
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      storage: memoryStorage(),
    }),
  )
  async updateProduct(
    @Param('id') id: string,
    @Body() updateMarketplaceManagementDto: UpdateMarketplaceManagementDto,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    return this.marketplaceManagementService.updateProduct(
      id,
      updateMarketplaceManagementDto,
      images,
    );
  }

  @ApiOperation({ summary: 'Delete a product permanently' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('product/:id')
  async remove(@Param('id') id: string) {
    return this.marketplaceManagementService.remove(id);
  }

  @ApiOperation({ summary: 'Update a product status' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('product/:id/update/status')
  async updateProductStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.marketplaceManagementService.updateProductStatus(id, status);
  }

  // =============== Category Endpoints ===============

  @ApiOperation({ summary: 'Create a new product category' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Post('categories/create')
  async createCategory(@Body() body: { name: string; description?: string }) {
    return this.marketplaceManagementService.createCategory(body);
  }

  @ApiOperation({ summary: 'Get all product categories' })
  @Get('categories/all')
  async findAllCategories() {
    return this.marketplaceManagementService.findAllCategories();
  }

  @ApiOperation({ summary: 'Get a product category by ID' })
  @Get('categories/:id')
  async findCategoryById(@Param('id') id: string) {
    return this.marketplaceManagementService.findCategoryById(id);
  }

  @ApiOperation({ summary: 'Delete a product category' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string) {
    return this.marketplaceManagementService.deleteCategory(id);
  }

  @ApiOperation({ summary: 'Add to Cart' })
  @Post('product/cart/add')
  async addToCart(
    @GetUser('userId') userId: string,
    @Body() body: { product_id: string; quantity: number },
  ) {
    return this.marketplaceManagementService.addToCart({ ...body, userId });
  }

  @ApiOperation({ summary: 'Get Cart Items' })
  @Get('product/cart/items')
  async getCartItems(@GetUser('userId') userId: string) {
    return this.marketplaceManagementService.getCartItems(userId);
  }

  @ApiOperation({ summary: 'Remove from Cart' })
  @Delete('product/cart/remove')
  async removeFromCart(
    @GetUser('userId') userId: string,
    @Body() body: { product_id: string },
  ) {
    return this.marketplaceManagementService.removeFromCart({
      ...body,
      userId,
    });
  }

  // =============== Checkout & Orders ===============

  @ApiOperation({ summary: 'Checkout - Create order and payment intent' })
  @Post('checkout')
  async checkout(
    @GetUser('userId') userId: string,
    @Body()
    body: {
      shipping_address: string;
      shipping_city?: string;
      shipping_state?: string;
      shipping_country?: string;
      shipping_zip_code?: string;
      shipping_phone?: string;
      email?: string;
    },
  ) {
    return this.marketplaceManagementService.checkout({ ...body, userId });
  }

  @ApiOperation({ summary: 'Get order status (for polling after payment)' })
  @Get('order/:orderId/status')
  async getOrderStatus(@Param('orderId') orderId: string) {
    return this.marketplaceManagementService.getOrderStatus(orderId);
  }

  @ApiOperation({ summary: 'Get order history for logged-in user' })
  @Get('orders/history')
  async getOrderHistory(@GetUser('userId') userId: string) {
    return this.marketplaceManagementService.getOrderHistory(userId);
  }

  @ApiOperation({ summary: 'Get specific order details' })
  @Get('order/:orderId')
  async getOrderById(
    @GetUser('userId') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.marketplaceManagementService.getOrderById(userId, orderId);
  }

  // =============== Admin Order Management ===============

  @ApiOperation({ summary: 'Get all orders (Admin)' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/orders')
  async getAllOrders(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.marketplaceManagementService.getAllOrders(page, limit);
  }

  @ApiOperation({ summary: 'Update order status (Admin)' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('admin/order/:orderId/status')
  async updateOrderStatus(
    @Param('orderId') orderId: string,
    @Body('status') status: string,
  ) {
    return this.marketplaceManagementService.updateOrderStatus(orderId, status);
  }

  @ApiOperation({ summary: 'Get order details by ID (Admin)' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/order/:orderId')
  async getOrderDetailsById(@Param('orderId') orderId: string) {
    return this.marketplaceManagementService.getOrderDetailsById(orderId);
  }
}
