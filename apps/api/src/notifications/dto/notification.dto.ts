import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NotificationType } from '@prisma/client';

export class CreateNotificationDto {
  @IsEnum(NotificationType) type: NotificationType;
  @IsString() @IsNotEmpty() title: string;
  @IsString() @IsNotEmpty() message: string;
  @IsString() @IsOptional() entityId?: string;
}
