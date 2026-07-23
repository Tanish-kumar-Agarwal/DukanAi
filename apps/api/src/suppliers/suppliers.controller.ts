import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto, RecordSupplierPaymentDto, UpdateSupplierDto } from './dto/supplier.dto';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll() {
    return this.suppliersService.findAll();
  }

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }

  @Post(':id/payments')
  recordPayment(@Param('id') id: string, @Body() dto: RecordSupplierPaymentDto) {
    return this.suppliersService.recordPayment(id, dto.amount);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliersService.softDelete(id);
  }
}
