import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  try {
    const customers = await prisma.customer.findMany();
    console.log(`Found ${customers.length} customers in the database via Prisma!`);
    console.log(JSON.stringify(customers, null, 2));
  } catch (e) {
    console.error('Error fetching customers:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
