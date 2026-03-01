export class CreateMarketplaceManagementDto {
  productName: string;
  categoryId?: string;
  price?: number | string;
  stockQuantity?: number | string;
  brandName?: string;
  discount?: number | string;
  description?: string;
  isActive?: boolean | string;
  image?: string; // Base64 image string or URL
}
