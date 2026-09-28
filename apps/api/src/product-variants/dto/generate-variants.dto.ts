import { IsObject, registerDecorator, ValidationOptions } from 'class-validator';

/** `{ Colour: ['Red', 'Blue'], Size: ['S', 'M'] }`: every value a non-empty array of strings. */
function IsAttributeMatrix(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isAttributeMatrix',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: 'attributes must map each attribute name to a non-empty array of strings', ...options },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.values(value as Record<string, unknown>).every(
            (options) => Array.isArray(options) && options.length > 0 && options.every((o) => typeof o === 'string' && o.length > 0),
          ),
      },
    });
  };
}

export class GenerateVariantsDto {
  @IsObject()
  @IsAttributeMatrix()
  attributes: Record<string, string[]>;
}
