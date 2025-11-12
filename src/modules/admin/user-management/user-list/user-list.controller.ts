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
  @Get()
  async findAll(
    @Query() query: QueryUserListDto
  ) {
    return this.userListService.findAll(query);
  }

  @ApiOperation({ summary: 'Get user details by ID (coach or athlete)' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.userListService.findOne(id);
  }

  @ApiConsumes('multipart/form-data')
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

  @ApiOperation({ summary: 'Delete user by ID' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.userListService.remove(id);
  }
}
