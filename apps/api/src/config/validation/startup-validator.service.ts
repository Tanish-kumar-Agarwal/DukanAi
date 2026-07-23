import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ValidationEngine } from './validation.engine';
import { ValidationContext } from './validation.context';
import { ValidationSeverity } from './enums/validation-severity.enum';

@Injectable()
export class StartupValidatorService implements OnModuleInit {
  private readonly logger = new Logger('RuntimeValidationEngine');

  constructor(
    private readonly validationEngine: ValidationEngine,
    private readonly validationContext: ValidationContext,
  ) {}

  async onModuleInit() {
    this.logger.log('Executing Enterprise Runtime Validation...');
    const errors = await this.validationEngine.validateAll(this.validationContext);

    if (errors.length === 0) {
      this.logger.log('Runtime Validation Passed. Configuration graph is valid.');
      return;
    }

    const criticalOrHigh = errors.filter(
      e => e.severity === ValidationSeverity.CRITICAL || e.severity === ValidationSeverity.HIGH
    );

    if (criticalOrHigh.length > 0) {
      this.logger.error('================================================================================');
      this.logger.error('                         STARTUP VALIDATION FAILED                              ');
      this.logger.error('================================================================================');
      this.logger.error(`Found ${criticalOrHigh.length} CRITICAL/HIGH violation(s).`);
      
      criticalOrHigh.forEach((e, i) => {
        this.logger.error(`\n[Violation ${i + 1}]`);
        this.logger.error(`  - Domain:     ${e.domain}`);
        if (e.property) this.logger.error(`  - Property:   ${e.property}`);
        if (e.dependency) this.logger.error(`  - Dependency: ${e.dependency}`);
        this.logger.error(`  - Category:   ${e.category}`);
        this.logger.error(`  - Severity:   ${e.severity}`);
        this.logger.error(`  - Reason:     ${e.reason}`);
        this.logger.error(`  - Resolution: ${e.resolution}`);
      });
      
      this.logger.error('================================================================================');
      this.logger.error('Application cannot safely start. Halting process.');

      process.exit(1);
    } else {
      this.logger.warn(`Found ${errors.length} WARNING/INFO violations.`);
      errors.forEach((e, i) => {
        this.logger.warn(`[Warning ${i + 1}] [${e.domain}] ${e.reason} (Resolution: ${e.resolution})`);
      });
    }
  }
}
