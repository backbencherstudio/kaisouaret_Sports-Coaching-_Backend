import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Req,
  } from '@nestjs/common';
  import { SubscriptionService } from '../../../modules/payment/subscription.service';
  import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
  import { RolesGuard } from '../../../common/guard/role/roles.guard';
  import { JwtAuthGuard } from '../../../modules/auth/guards/jwt-auth.guard';
  import { Role } from '../../../common/guard/role/role.enum';
  import { Roles } from '../../../common/guard/role/roles.decorator';
  
  @ApiBearerAuth()
  @ApiTags('Subscription Plans (Admin)')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Controller('admin/subscription-plans')
  export class SubscriptionPlansController {
    constructor(private readonly subscriptionService: SubscriptionService) {}
  
    @ApiOperation({ summary: 'Create or Update Subscription Plan' })
    @Post()
    async createOrUpdatePlan(@Body() body: {
      plan_id?: string;
      name: string;
      price: number;
      currency?: string;
      interval?: string;
      features?: string[];
      description?: string;
    }) {
      try {
        return await this.subscriptionService.createOrUpdatePlan(body);
      } catch (error) {
        return {
          success: false,
          message: error.message,
        };
      }
    }
  
    @ApiOperation({ summary: 'Get All Subscription Plans' })
    @Get()
    async getAllPlans() {
      try {
        return await this.subscriptionService.getAllPlans();
      } catch (error) {
        return {
          success: false,
          message: error.message,
        };
      }
    }
  }