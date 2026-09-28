import { IsString, MaxLength } from 'class-validator';

export class TagMediaDto {
  @IsString()
  assetId: string;

  @IsString()
  @MaxLength(100)
  tag: string;
}
