export class CreateMarketplaceManagementDto {
  productName: string;
  categoryId?: string;
  price?: number | string;
  stockQuantity?: number | string;
  brandSeller?: string;
  discount?: number | string;
  description?: string;
  isActive?: boolean | string;
}
