import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

async function run() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const cache = app.get(CACHE_MANAGER);
    const anyCache = cache as any;
    if (anyCache.stores && anyCache.stores.length > 0) {
       const store = anyCache.stores[0];
       if (store.opts && store.opts.store) {
           console.log('opts.store keys:', Object.keys(store.opts.store));
           console.log('Client on opts.store:', !!store.opts.store.client);
           if (store.opts.store.client) {
             console.log('Client is available!');
           }
       }
    }
    await app.close();
  } catch (e) {
    console.error(e);
  }
}
run();
