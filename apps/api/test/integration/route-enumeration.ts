import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ANY_AUTHENTICATED_KEY } from '../../src/auth/any-authenticated.decorator';
import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator';
import { ROLES_KEY } from '../../src/auth/roles.decorator';

/**
 * Every route handler of the booted app, read from the Nest discovery
 * metadata (the source `RouteAuthorizationAssertion` uses at boot), so a new
 * controller is covered by the suites that walk the surface (route walker,
 * financial visibility) without touching them.
 */
export interface Handler {
  key: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  isPublic: boolean;
  anyAuthenticated: boolean;
  roles: Role[] | undefined;
}

const METHODS: Record<number, Handler['method'] | undefined> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

export function enumerateHandlers(app: INestApplication): Handler[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const handlers = new Map<string, Handler>();
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const prefixes = ([] as string[]).concat((Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined) ?? '');
    const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, metatype) === true;
    const classAny = Reflect.getMetadata(ANY_AUTHENTICATED_KEY, metatype) === true;
    const classRoles = Reflect.getMetadata(ROLES_KEY, metatype) as Role[] | undefined;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const fn = prototype[name];
      if (typeof fn !== 'function') continue;
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, fn) as number];
      if (!method) continue;
      const paths = ([] as string[]).concat((Reflect.getMetadata(PATH_METADATA, fn) as string | string[] | undefined) ?? '');
      for (const prefix of prefixes) {
        for (const sub of paths) {
          const path = ('/api/' + [prefix, sub].filter((p) => p && p !== '/').join('/')).replace(/\/+/g, '/').replace(/\/$/, '');
          const key = `${method} ${path}`;
          handlers.set(key, {
            key,
            method,
            path,
            isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, fn) === true,
            anyAuthenticated: classAny || Reflect.getMetadata(ANY_AUTHENTICATED_KEY, fn) === true,
            roles: (Reflect.getMetadata(ROLES_KEY, fn) as Role[] | undefined) ?? classRoles,
          });
        }
      }
    }
  }
  return [...handlers.values()].sort((a, b) => a.key.localeCompare(b.key));
}
