import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ModulesContainer } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const container = app.get(ModulesContainer);

  const providerCounts = new Map<any, string[]>();
  const instances = new Map<any, Set<any>>();

  for (const module of container.values()) {
    for (const [token, wrapper] of module.providers.entries()) {
      // Ignore internal NestJS providers and string tokens
      if (typeof token !== 'function') continue;
      
      const className = token.name;
      if (!className) continue;

      if (!providerCounts.has(className)) {
        providerCounts.set(className, []);
      }
      providerCounts.get(className)!.push(module.name);

      if (wrapper.instance) {
        if (!instances.has(className)) {
          instances.set(className, new Set());
        }
        instances.get(className)!.add(wrapper.instance);
      }
    }
  }

  let hasDuplicates = false;

  for (const [token, modules] of providerCounts.entries()) {
    // Only care if provided in multiple modules
    if (modules.length > 1) {
      const instanceSet = instances.get(token);
      if (instanceSet && instanceSet.size > 1) {
        console.log(`\nDUPLICATE SINGLETON DETECTED:`);
        console.log(`Provider: ${token.name}`);
        console.log(`Registered in modules: ${modules.join(', ')}`);
        console.log(`Number of distinct instances created: ${instanceSet.size}`);
        hasDuplicates = true;
      }
    }
  }

  if (!hasDuplicates) {
    console.log('\nNo duplicate singletons detected in the DI Container!');
  }

  await app.close();
}

bootstrap().catch(err => {
  console.error(err);
  setTimeout(() => process.exit(1), 100);
});
