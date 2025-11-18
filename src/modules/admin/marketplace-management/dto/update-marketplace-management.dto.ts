import { PartialType } from '@nestjs/swagger';
import { CreateMarketplaceManagementDto } from './create-marketplace-management.dto';

export class UpdateMarketplaceManagementDto extends PartialType(CreateMarketplaceManagementDto) {}
