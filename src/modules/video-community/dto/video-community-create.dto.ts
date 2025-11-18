import { IsNotEmpty, IsOptional, IsString, IsInt } from 'class-validator';

export class CreatePostDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  thumbnail_key?: string;

  @IsOptional()
  @IsInt()
  duration?: number; // seconds

  // if true the video is only visible to premium/subscribed athletes
  @IsOptional()
  is_premium?: boolean;

  @IsOptional()
  @IsString()
  video_url?: string;
}
