import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { UserListService } from './user-list.service';
import { UpdateUserListDto } from './dto/update-user-list.dto';
import { QueryUserListDto, UserRole, UserStatus } from './dto/query-user-list.dto';

@ApiTags('User List')
@Controller('admin/user-list')
export class UserListController {
  constructor(private readonly userListService: UserListService) {}

  @ApiOperation({ summary: 'Get all users with search, filter, and pagination' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by user name or email' })
  @ApiQuery({ name: 'role', required: false, enum: ['coach', 'user'], description: 'Filter by role (coach or user/athlete)' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'blocked'], description: 'Filter by status (active or blocked)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved users' })
  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number = 10,
  ) {
    const queryDto: QueryUserListDto = {
      search,
      role: role as UserRole,
      status: status as UserStatus,
      page,
      limit,
    };
    return this.userListService.findAll(queryDto);
  }

  @ApiOperation({ summary: 'Get user details by ID (coach or athlete)' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved user details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.userListService.findOne(id);
  }

  @ApiOperation({ summary: 'Update user by ID (supports image upload)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        phone_number: { type: 'string' },
        status: { type: 'string', enum: ['active', 'blocked'] },
        bio: { type: 'string' },
        location: { type: 'string' },
        address: { type: 'string' },
        gender: { type: 'string' },
        age: { type: 'number' },
        image: {
          type: 'string',
          format: 'binary',
          description: 'User avatar image file',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
    }),
  )
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateUserListDto: UpdateUserListDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    return this.userListService.update(id, updateUserListDto, image);
  }

  @ApiOperation({ summary: 'Delete user by ID (hard delete - permanent)' })
  @ApiResponse({ status: 200, description: 'User permanently deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 400, description: 'Cannot delete user due to related records' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.userListService.remove(id);
  }
}
