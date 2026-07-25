import { Controller, Post, Body, Get, Put, Delete, Param, Logger, Request, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerSearchService } from './services/customer-search.service';
import { CreateEnterpriseCustomerDto } from './dto/enterprise-customer.dto';

@Controller('customers')
export class CustomersController {
  private readonly logger = new Logger(CustomersController.name);

  constructor(
    private readonly customersService: CustomersService,
    private readonly searchService: CustomerSearchService
  ) {}

  @Post()
  async create(@Request() req: any, @Body() dto: CreateEnterpriseCustomerDto | any) {
    return this.customersService.create(dto);
  }

  @Get()
  async findAll(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.customersService.findAll(skip ? +skip : undefined, take ? +take : undefined);
  }

  @Post('search')
  async search(@Request() req: any, @Body() body: { query: string, skip?: number, take?: number }) {
    return this.searchService.search(req.user.shopId, body.query, body.skip, body.take);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post(':id/payments')
  async recordPayment(
    @Param('id') id: string,
    @Body() body: { amount: number; mode?: string; notes?: string },
  ) {
    return this.customersService.recordPayment(id, Number(body.amount), body.mode, body.notes);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.customersService.softDelete(id);
  }
}

