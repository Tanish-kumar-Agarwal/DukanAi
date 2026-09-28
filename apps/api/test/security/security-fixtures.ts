/**
 * Helpers shared by the security regression specs: extra users on a fixture
 * shop and an HTTP client authenticated as one of them. Tokens are signed with
 * the application's own JwtService, exactly as a login would.
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { tenantRunner, TestShop } from '../integration/pos-fixtures';

export interface TestUser {
  id: string;
  email: string;
  role: Role;
}

/** Adds a user with the given role to `shop`; `password` is stored as a real bcrypt hash so the login route accepts it. */
export async function createUser(app: INestApplication, shop: TestShop, role: Role, password?: string): Promise<TestUser> {
  const prisma = app.get(PrismaService);
  const run = tenantRunner(app);
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}-${shop.suffix}@test.local`;
  const hash = password ? await bcrypt.hash(password, 4) : 'x';
  const user = await run.system(() => prisma.user.create({ data: { email, name: role, role, password: hash, shopId: shop.shopId } }));
  return { id: user.id, email, role };
}

export function bearerToken(app: INestApplication, shop: TestShop, user: TestUser): string {
  return app.get(JwtService).sign({ sub: user.id, email: user.email, role: user.role, shopId: shop.shopId, tokenVersion: 0 });
}

/** supertest calls pre-authenticated as `user` of `shop`. */
export function httpAs(app: INestApplication, shop: TestShop, user: TestUser) {
  const server = app.getHttpServer();
  const auth = `Bearer ${bearerToken(app, shop, user)}`;
  return {
    get: (url: string) => request(server).get(url).set('Authorization', auth),
    post: (url: string) => request(server).post(url).set('Authorization', auth),
    patch: (url: string) => request(server).patch(url).set('Authorization', auth),
  };
}

export function ownerOf(shop: TestShop): TestUser {
  return { id: shop.ownerId, email: `owner-${shop.suffix}@test.local`, role: Role.OWNER };
}
