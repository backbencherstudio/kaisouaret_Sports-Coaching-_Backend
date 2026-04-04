import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  async createProduct(
    createMarketplaceManagementDto: CreateMarketplaceManagementDto,
    images?: Express.Multer.File[],
  ) {
    const stockQuantity = this.coerceInt(
      createMarketplaceManagementDto.stockQuantity,
    );
    const price = this.toDecimal(createMarketplaceManagementDto.price);
    const discount = this.toDecimal(createMarketplaceManagementDto.discount);
    const isActive = this.coerceBoolean(
      createMarketplaceManagementDto.isActive,
      true,
    );

    const productData: any = {
      name: createMarketplaceManagementDto.productName,
      category: createMarketplaceManagementDto.categoryId,
      price,
      stock_quantity: stockQuantity ?? 0,
      brand_name: createMarketplaceManagementDto.brandName,
      discount,
      description: createMarketplaceManagementDto.description,
      is_active: isActive ?? true,
      images: [],
    };

    // Upload all provided images
    if (images?.length > 0) {
      try {
        const uploadedImages: string[] = [];
        for (const image of images) {
          // Validate image
          if (!image.buffer || image.buffer.length === 0) {
            throw new BadRequestException(
              `Invalid image file: ${image.originalname} has no content`,
            );
          }

          if (image.size > 10 * 1024 * 1024) {
            // 10MB limit
            throw new BadRequestException(
              `Image file too large: ${image.originalname} (${image.size} bytes). Max 10MB allowed.`,
            );
          }

          const fileName = `${StringHelper.randomString()}_${image.originalname}`;
          const uploadPath = appConfig().storageUrl.photo + '/' + fileName;

          try {
            console.log(`Uploading image: ${fileName} (${image.size} bytes)`);
            await SazedStorage.put(uploadPath, image.buffer);
            uploadedImages.push(fileName);
            console.log('Image uploaded successfully:', fileName);
          } catch (uploadError) {
            console.error(`Failed to upload ${fileName}:`, uploadError);
            throw new Error(
              `Failed to upload image ${image.originalname}: ${uploadError.message || uploadError}`,
            );
          }
        }
        productData.images = uploadedImages;
      } catch (error) {
        console.error('Image upload process failed:', error);
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw new BadRequestException(
          `Image upload failed: ${error.message || 'Unknown error'}. Please check storage service connectivity.`,
        );
      }
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
        { brand_name: { contains: search, mode: 'insensitive' } },
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

  async updateProduct(
    id: string,
    updateMarketplaceManagementDto: UpdateMarketplaceManagementDto,
    images?: Express.Multer.File[],
  ) {
    await this.ensureProductExists(id);

    const price = this.toDecimal(updateMarketplaceManagementDto.price);
    const discount = this.toDecimal(updateMarketplaceManagementDto.discount);
    const stockQuantity = this.coerceInt(
      updateMarketplaceManagementDto.stockQuantity,
    );
    const isActive = this.coerceBoolean(
      updateMarketplaceManagementDto.isActive,
    );

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
    if (updateMarketplaceManagementDto.brandName !== undefined) {
      updateData.brand_name = updateMarketplaceManagementDto.brandName;
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

    // Handle image update - replace all old images with new ones
    if (images && images.length > 0) {
      try {
        const existingProduct = await this.prisma.marketplaceProduct.findFirst({
          where: { id },
        });

        // Validate images first
        for (const image of images) {
          if (!image.buffer || image.buffer.length === 0) {
            throw new BadRequestException(
              `Invalid image file: ${image.originalname} has no content`,
            );
          }

          if (image.size > 10 * 1024 * 1024) {
            // 10MB limit
            throw new BadRequestException(
              `Image file too large: ${image.originalname} (${image.size} bytes). Max 10MB allowed.`,
            );
          }
        }

        // Delete all old images
        if (existingProduct?.images && existingProduct.images.length > 0) {
          for (const oldImage of existingProduct.images) {
            try {
              console.log(`Deleting old image: ${oldImage}`);
              await SazedStorage.delete(
                appConfig().storageUrl.photo + '/' + oldImage,
              );
              console.log(`Deleted old image: ${oldImage}`);
            } catch (deleteError) {
              console.warn(
                `Failed to delete old image ${oldImage}:`,
                deleteError,
              );
              // Don't throw, continue with new uploads
            }
          }
        }

        // Upload new images
        const newImageFiles: string[] = [];
        for (const image of images) {
          const fileName = `${StringHelper.randomString()}_${image.originalname}`;
          const uploadPath = appConfig().storageUrl.photo + '/' + fileName;

          try {
            console.log(`Uploading image: ${fileName} (${image.size} bytes)`);
            await SazedStorage.put(uploadPath, image.buffer);
            newImageFiles.push(fileName);
            console.log('Image uploaded successfully:', fileName);
          } catch (uploadError) {
            console.error(`Failed to upload ${fileName}:`, uploadError);
            throw new Error(
              `Failed to upload image ${image.originalname}: ${uploadError.message || uploadError}`,
            );
          }
        }
        updateData.images = newImageFiles;
      } catch (error) {
        console.error('Image update process failed:', error);
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw new BadRequestException(
          `Image update failed: ${error.message || 'Unknown error'}. Please check storage service connectivity.`,
        );
      }
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

  async updateProductStatus(id: string, status: string) {
    await this.ensureProductExists(id);

    const validStatuses = [
      'active',
      'inactive',
      'out_of_stock',
      'discontinued',
    ];
    if (!validStatuses.includes(status.toLowerCase())) {
      throw new Error('Invalid status value');
    }

    const product = await this.prisma.marketplaceProduct.update({
      where: { id, deleted_at: null },
      data: {
        status: status.toUpperCase() as any, // Convert to enum value
      },
    });

    const statusData = {
      id: product.id,
      name: product.name,
      status: product.status,
      updated_at: product.updated_at,
    };

    return {
      success: true,
      data: statusData,
    };
  }

  // =============== Category Service Methods ===============

  async createCategory(body: { name: string; description?: string }) {
    try {
      const checkExisting = await this.prisma.productCategory.findFirst({
        where: {
          name: body.name,
          deleted_at: null,
        },
      });

      if (checkExisting) {
        throw new BadRequestException('Category with this name already exists');
      }

      const category = await this.prisma.productCategory.create({
        data: {
          name: body.name,
          description: body.description,
        },
      });

      return {
        success: true,
        data: category,
      };
    } catch (error) {
      console.error('Failed to create category:', error);
      throw new BadRequestException(
        `Failed to create category: ${error.message}`,
      );
    }
  }

  async findAllCategories() {
    const categories = await this.prisma.productCategory.findMany({
      where: {
        deleted_at: null,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
    return {
      success: true,
      data: categories,
    };
  }

  async findCategoryById(id: string) {
    const category = await this.prisma.productCategory.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return {
      success: true,
      data: category,
    };
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.productCategory.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    await this.prisma.productCategory.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });

    return {
      success: true,
      message: 'Category deleted successfully',
    };
  }

  // =============== Cart Service ===============
  async addToCart(body: {
    userId: string;
    product_id: string;
    quantity: number;
  }) {
    const { userId, product_id, quantity } = body;

    if (
      userId === undefined ||
      product_id === undefined ||
      quantity === undefined
    ) {
      throw new BadRequestException(
        'Missing required fields: userId, product_id, or quantity',
      );
    }

    const normalizedQuantity = this.coerceInt(quantity);
    if (!normalizedQuantity || normalizedQuantity <= 0) {
      throw new BadRequestException('Quantity must be a positive number');
    }

    const checkUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
      },
    });
    if (!checkUser) {
      throw new NotFoundException('User not found');
    }

    const product = await this.prisma.marketplaceProduct.findFirst({
      where: {
        id: product_id,
        deleted_at: null,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (!product.is_active || product.status !== 'ACTIVE') {
      throw new BadRequestException('Product is not available for purchase');
    }

    if (product.stock_quantity <= 0) {
      throw new BadRequestException('Product is out of stock');
    }

    if (product.stock_quantity < normalizedQuantity) {
      throw new BadRequestException('Insufficient stock available');
    }

    const existingCartItem = await this.prisma.addToCart.findFirst({
      where: {
        user_id: userId,
        product_id,
      },
    });

    const unitPrice = Number(product.price) || 0;

    if (existingCartItem) {
      const requestedQuantity = existingCartItem.quantity + normalizedQuantity;
      const newQuantity = Math.min(requestedQuantity, product.stock_quantity);
      const capped = newQuantity < requestedQuantity;

      await this.prisma.addToCart.update({
        where: { id: existingCartItem.id },
        data: {
          quantity: newQuantity,
          amount: unitPrice * newQuantity,
        },
      });

      return {
        success: true,
        message: capped
          ? `Quantity capped to available stock (${newQuantity}).`
          : `Updated quantity of product in cart to ${newQuantity} successfully`,
        data: {
          id: existingCartItem.id,
          user_id: existingCartItem.user_id,
          product_id: existingCartItem.product_id,
          quantity: newQuantity,
          unit_price: unitPrice,
          amount: unitPrice * newQuantity,
        },
      };
    }

    const finalQuantity = Math.min(normalizedQuantity, product.stock_quantity);
    const capped = finalQuantity < normalizedQuantity;

    const addedCartItem = await this.prisma.addToCart.create({
      data: {
        user_id: userId,
        product_id,
        quantity: finalQuantity,
        amount: unitPrice * finalQuantity,
        image:
          product.images && product.images.length > 0
            ? product.images[0]
            : null,
      },
    });

    const cartItemData = {
      id: addedCartItem.id,
      user_id: addedCartItem.user_id,
      product_id: addedCartItem.product_id,
      quantity: addedCartItem.quantity,
      unit_price: unitPrice,
      amount: unitPrice * addedCartItem.quantity,
      created_at: addedCartItem.created_at,
      updated_at: addedCartItem.updated_at,
    };

    return {
      success: true,
      message: capped
        ? `Quantity capped to available stock (${finalQuantity}).`
        : `Added ${finalQuantity} of ${product.name} to cart successfully`,
      data: cartItemData,
    };
  }

  async getCartItems(userId: string) {
    const checkUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
      },
    });
    if (!checkUser) {
      throw new NotFoundException('User not found');
    }

    const cartItems = await this.prisma.addToCart.findMany({
      where: {
        user_id: userId,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    if (cartItems.length === 0) {
      return {
        success: true,
        message: 'Cart is empty',
        data: [],
        summary: {
          subtotal: 0,
          tax: 0,
          shipping: 0,
          total: 0,
        },
      };
    }

    // Fetch product details for each cart item
    const productIds = cartItems.map((item) => item.product_id);
    const products = await this.prisma.marketplaceProduct.findMany({
      where: {
        id: { in: productIds },
        deleted_at: null,
      },
    });

    const productMap: Record<string, MarketplaceProduct> = {};
    for (const product of products) {
      productMap[product.id] = product;
    }

    // Build cart items with product details
    const calculatedCartItems = cartItems.map((item) => {
      const product = productMap[item.product_id];

   

      const unitPrice = Number(product.price) || 0;
      const quantity = item.quantity || 1;
      const itemSubtotal = unitPrice * quantity;

      // Get product image URL
      let images: string[] = [];
      if (product.images && product.images.length > 0) {
        images = product.images.map((image: string) => {
          if (image.startsWith('http://') || image.startsWith('https://')) {
            return image;
          }
          return SazedStorage.url(appConfig().storageUrl.photo + '/' + image);
        });
      }

      return {
        id: item.id,
        product_id: item.product_id,
        product_name: product.name,
        product_description: product.description,
        images: images,
        quantity: quantity,
        unit_price: unitPrice,
        subtotal: itemSubtotal,
        created_at: item.created_at,
        updated_at: item.updated_at,
      };
    });

    // Calculate totals
    const subtotal = calculatedCartItems.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );
    const tax = 0; // Can be calculated based on location/regulations
    const shipping = 0; // Can be calculated based on location
    const total = subtotal + tax + shipping;

    return {
      success: true,
      message: `Cart contains ${calculatedCartItems.length} item(s)`,
      data: calculatedCartItems,
      summary: {
        subtotal: Number(subtotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        shipping: Number(shipping.toFixed(2)),
        total: Number(total.toFixed(2)),
        item_count: calculatedCartItems.length,
      },
    };
  }

  async removeFromCart(body: { userId: string; product_id: string }) {
    const { userId, product_id } = body;

    if (userId === undefined || product_id === undefined) {
      throw new BadRequestException(
        'Missing required fields: userId or product_id',
      );
    }

    const checkUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
      },
    });

    if (!checkUser) {
      throw new NotFoundException('User not found');
    }

    const existingCartItem = await this.prisma.addToCart.findFirst({
      where: {
        user_id: userId,
        product_id,
      },
    });

    if (!existingCartItem) {
      throw new NotFoundException(
        'Cart item not found for this user and product',
      );
    }

    await this.prisma.addToCart.delete({
      where: { id: existingCartItem.id },
    });

    return {
      success: true,
      message: `Removed product ${product_id} from cart successfully`,
    };
  }

  // =============== Checkout & Orders ===============

  async checkout(body: {
    userId: string;
    shipping_address: string;
    shipping_city?: string;
    shipping_state?: string;
    shipping_country?: string;
    shipping_zip_code?: string;
    shipping_phone?: string;
    email?: string;
  }) {
    const { userId, ...shippingDetails } = body;

    if (!userId || !shippingDetails.shipping_address) {
      throw new BadRequestException(
        'Missing required fields: userId or shipping_address',
      );
    }

    // Verify user exists
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get cart items
    const cartItems = await this.prisma.addToCart.findMany({
      where: { user_id: userId },
      include: {
        product: true,
      },
    });

    if (cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Validate stock availability and calculate total
    let totalAmount = 0;
    const orderItemsData = [];

    for (const cartItem of cartItems) {
      const product = cartItem.product;

      // Check product availability
      if (!product.is_active || product.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Product ${product.name} is no longer available`,
        );
      }

      // Check stock
      if (product.stock_quantity < cartItem.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${product.name}. Available: ${product.stock_quantity}, Requested: ${cartItem.quantity}`,
        );
      }

      const unitPrice = Number(product.price) || 0;
      const subtotal = unitPrice * cartItem.quantity;
      totalAmount += subtotal;

      orderItemsData.push({
        product_id: product.id,
        quantity: cartItem.quantity,
        unit_price: new Prisma.Decimal(unitPrice),
        subtotal: new Prisma.Decimal(subtotal),
        product_name: product.name,
        product_description: product.description,
        product_image:
          product.images && product.images.length > 0
            ? product.images[0]
            : null,
      });
    }

    // Create payment intent using StripePayment
    const { StripePayment } = await import(
      '../../../common/lib/Payment/stripe/StripePayment'
    );

    let stripeCustomerId = user.billing_id;

    // Create Stripe customer if not exists
    if (!stripeCustomerId) {
      const customer = await StripePayment.createCustomer({
        user_id: userId,
        name: user.name || user.email,
        email: user.email,
      });
      stripeCustomerId = customer.id;

      // Update user with billing_id
      await this.prisma.user.update({
        where: { id: userId },
        data: { billing_id: stripeCustomerId },
      });
    }

    // Create payment intent (amount goes directly to admin account)
    // Create temporary payment transaction first to get the ID
    const tempPaymentTransaction = await this.prisma.paymentTransaction.create({
      data: {
        user_id: userId,
        type: 'marketplace',
        amount: new Prisma.Decimal(totalAmount),
        currency: 'usd',
        status: 'pending',
      },
    });

    // Create order with temporary transaction
    const order = await this.prisma.marketplaceOrder.create({
      data: {
        user_id: userId,
        total_amount: new Prisma.Decimal(totalAmount),
        currency: 'usd',
        status: 'PENDING',
        payment_transaction_id: tempPaymentTransaction.id,
        shipping_address: shippingDetails.shipping_address,
        shipping_city: shippingDetails.shipping_city,
        shipping_state: shippingDetails.shipping_state,
        shipping_country: shippingDetails.shipping_country,
        shipping_zip_code: shippingDetails.shipping_zip_code,
        shipping_phone: shippingDetails.shipping_phone,
        email: shippingDetails.email || user.email,
        order_items: {
          create: orderItemsData,
        },
      },
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
      },
    });

    // Now create payment intent with order_id in metadata
    const paymentIntent = await StripePayment.createPaymentIntent({
      amount: totalAmount,
      currency: 'usd',
      customer_id: stripeCustomerId,
      metadata: {
        user_id: userId,
        order_type: 'marketplace',
        order_id: order.id,
        item_count: cartItems.length.toString(),
      },
    });

    // Update payment transaction with PaymentIntent details
    await this.prisma.paymentTransaction.update({
      where: { id: tempPaymentTransaction.id },
      data: {
        payment_gateway: 'stripe',
        payment_intent_id: paymentIntent.id,
        reference_number: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        raw_status: paymentIntent.status,
      },
    });

    // Clear cart after successful order creation
    await this.prisma.addToCart.deleteMany({
      where: { user_id: userId },
    });

    return {
      success: true,
      message: 'Order created successfully. Complete payment to confirm order.',
      data: {
        order_id: order.id,
        payment_intent_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        total_amount: totalAmount,
        currency: 'usd',
        order,
      },
    };
  }

  async confirmOrderInternal(orderId: string) {
    // Find order
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { id: orderId },
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
        payment_transaction: true,
      },
    });

    if (!order) {
      console.error(`Order ${orderId} not found for confirmation`);
      throw new NotFoundException('Order not found');
    }

    // Check if order is already confirmed
    if (order.status !== 'PENDING') {
      console.log(`Order ${orderId} already ${order.status}, skipping confirmation`);
      return order;
    }

    // Update stock quantities and sold quantities
    for (const item of order.order_items) {
      // Check stock availability first
      if (item.product.stock_quantity < item.quantity) {
        console.error(
          `Insufficient stock for product: ${item.product_name} (Order: ${orderId})`,
        );
        // Log error but don't fail - payment already succeeded
        // Admin should handle this manually
        continue;
      }

      await this.prisma.marketplaceProduct.update({
        where: { id: item.product_id },
        data: {
          stock_quantity: {
            decrement: item.quantity,
          },
          sold_quantity: {
            increment: item.quantity,
          },
        },
      });
    }

    // Update order status
    const updatedOrder = await this.prisma.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        status: 'CONFIRMED',
      },
      include: {
        order_items: true,
      },
    });

    // Update payment transaction
    await this.prisma.paymentTransaction.update({
      where: { id: order.payment_transaction_id },
      data: {
        status: 'captured',
      },
    });

    console.log(`Order ${orderId} confirmed successfully via webhook`);
    return updatedOrder;
  }

  /**
   * Get order status (for frontend polling after payment)
   */
  async getOrderStatus(orderId: string) {
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        total_amount: true,
        currency: true,
        created_at: true,
        payment_transaction: {
          select: {
            status: true,
            raw_status: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return {
      success: true,
      data: {
        order_id: order.id,
        status: order.status,
        total_amount: Number(order.total_amount),
        currency: order.currency,
        payment_status: order.payment_transaction?.status || 'unknown',
        created_at: order.created_at,
      },
    };
  }

  async getOrderHistory(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const orders = await this.prisma.marketplaceOrder.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
      },
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
        payment_transaction: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // Serialize orders with image URLs
    const serializedOrders = orders.map((order) => ({
      ...order,
      total_amount: Number(order.total_amount),
      order_items: order.order_items.map((item) => {
        let imageUrl = null;
        if (item.product_image) {
          if (
            item.product_image.startsWith('http://') ||
            item.product_image.startsWith('https://')
          ) {
            imageUrl = item.product_image;
          } else {
            imageUrl = SazedStorage.url(
              appConfig().storageUrl.photo + '/' + item.product_image,
            );
          }
        }

        return {
          ...item,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          product_image: imageUrl,
        };
      }),
    }));

    return {
      success: true,
      message: `Retrieved ${orders.length} order(s)`,
      data: serializedOrders,
    };
  }

  async getOrderById(userId: string, orderId: string) {
    const order = await this.prisma.marketplaceOrder.findFirst({
      where: {
        id: orderId,
        user_id: userId,
        deleted_at: null,
      },
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
        payment_transaction: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Serialize order with image URLs
    const serializedOrder = {
      ...order,
      total_amount: Number(order.total_amount),
      order_items: order.order_items.map((item) => {
        let imageUrl = null;
        if (item.product_image) {
          if (
            item.product_image.startsWith('http://') ||
            item.product_image.startsWith('https://')
          ) {
            imageUrl = item.product_image;
          } else {
            imageUrl = SazedStorage.url(
              appConfig().storageUrl.photo + '/' + item.product_image,
            );
          }
        }

        return {
          ...item,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          product_image: imageUrl,
        };
      }),
    };

    return {
      success: true,
      message: 'Order retrieved successfully',
      data: serializedOrder,
    };
  }


  async getAllOrders(page: number = 1, limit: number = 10) {
    try {
      // Normalize pagination parameters
      const normalizedPage = Math.max(page, 1);
      const normalizedLimit = Math.min(Math.max(limit, 1), 100);
      const skip = (normalizedPage - 1) * normalizedLimit;

      // Fetch orders and count in parallel
      const [orders, total] = await Promise.all([
        this.prisma.marketplaceOrder.findMany({
          where: {
            deleted_at: null,
          },
          include: {
            order_items: {
              include: {
                product: true,
              },
            },
            payment_transaction: true,
          },
          orderBy: {
            created_at: 'desc',
          },
          skip,
          take: normalizedLimit,
        }),
        this.prisma.marketplaceOrder.count({
          where: {
            deleted_at: null,
          },
        }),
      ]);

      const totalPages = Math.max(Math.ceil(total / normalizedLimit), 1);

      const serializedOrders = orders.map((order) => ({
        ...order,
        total_amount: Number(order.total_amount),
        order_items: order.order_items.map((item) => {
          let imageUrl = null;
          if (item.product_image) {
            if (
              item.product_image.startsWith('http://') ||
              item.product_image.startsWith('https://')
            ) {
              imageUrl = item.product_image;
            } else {
              imageUrl = SazedStorage.url(
                appConfig().storageUrl.photo + '/' + item.product_image,
              );
            }
          }

          return {
            ...item,
            unit_price: Number(item.unit_price),
            subtotal: Number(item.subtotal),
            product_image: imageUrl,
          };
        }),
      }));
      
      return {
        success: true,
        message: `Retrieved ${orders.length} order(s)`,
        data: serializedOrders,
        pagination: {
          page: normalizedPage,
          limit: normalizedLimit,
          total,
          total_pages: totalPages,
          has_next_page: normalizedPage < totalPages,
          has_previous_page: normalizedPage > 1,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  async getOrderDetailsById(orderId: string) {
    const order = await this.prisma.marketplaceOrder.findFirst({
      where: {
        id: orderId,
        deleted_at: null,
      },
      include: {
        order_items: {
          include: {
            product: true,
          },
        },
        payment_transaction: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Serialize order with image URLs
    const serializedOrder = {
      ...order,
      total_amount: Number(order.total_amount),
      order_items: order.order_items.map((item) => {
        let imageUrl = null;
        if (item.product_image) {
          if (
            item.product_image.startsWith('http://') ||
            item.product_image.startsWith('https://')
          ) {
            imageUrl = item.product_image;
          } else {
            imageUrl = SazedStorage.url(
              appConfig().storageUrl.photo + '/' + item.product_image,
            );
          }
        }

        return {
          ...item,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          product_image: imageUrl,
        };
      }),
    };

    return {
      success: true,
      message: 'Order details retrieved successfully',
      data: serializedOrder,
    };
  }
 
  async updateOrderStatus(orderId: string, status: string) {
    const order = await this.prisma.marketplaceOrder.findFirst({
      where: {
        id: orderId,
        deleted_at: null,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const validStatuses = [
      'PENDING',
      'CONFIRMED',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
    ];
    if (!validStatuses.includes(status.toUpperCase())) {
      throw new BadRequestException('Invalid status value');
    }

    const updatedOrder = await this.prisma.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        status: status.toUpperCase() as any,
      },
    });

    return {
      success: true,
      message: `Order status updated to ${updatedOrder.status} successfully`,
      data: {
        id: updatedOrder.id,
        status: updatedOrder.status,
        updated_at: updatedOrder.updated_at,
      },
    };
  }





  // =============== Helper Methods ===============

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

  private serializeProduct(
    product: MarketplaceProduct,
    includeImage: boolean = true,
  ) {
    const serialized: any = {
      id: product.id,
      status: product.status,
      productName: product.name,
      categoryId: product.category,
      price: product.price ? Number(product.price) : 0,
      stockQuantity: product.stock_quantity,
      brandName: product.brand_name,
      discount: product.discount ? Number(product.discount) : 0,
      description: product.description,
      isActive: product.is_active,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    };

    if (includeImage) {
      if (product.images && product.images.length > 0) {
        // Map all images to their full URLs
        serialized.images = product.images.map((image: string) => {
          if (image.startsWith('http://') || image.startsWith('https://')) {
            return image;
          } else {
            return SazedStorage.url(appConfig().storageUrl.photo + '/' + image);
          }
        });
        serialized.hasImages = true;
      } else {
        serialized.images = [];
        serialized.hasImages = false;
      }
    } else {
      serialized.hasImages = !!(product.images && product.images.length > 0);
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

  private coerceBoolean(
    value?: boolean | string | number | null,
    defaultValue?: boolean,
  ) {
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
