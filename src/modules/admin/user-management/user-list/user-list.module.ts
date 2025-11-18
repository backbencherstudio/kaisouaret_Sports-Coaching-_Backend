import { Module } from '@nestjs/common';
import { UserListService } from './user-list.service';
import { UserListController } from './user-list.controller';

@Module({
  controllers: [UserListController],
  providers: [UserListService],
})
export class UserListModule {}
