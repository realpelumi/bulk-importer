import { ValidationRule, ValidationError } from '../types/import.types';

export class Validators {
  /**
   * Validate a single field value against a rule
   */
  static validateField(value: any, rule: ValidationRule, row: Record<string, any>): ValidationError | null {
    const errors: string[] = [];

    // Required check
    if (rule.required && (value === undefined || value === null || value === '')) {
      return {
        field: rule.field,
        message: `${rule.field} is required`,
        value,
      };
    }

    // Skip further validation if value is empty and not required
    if (value === undefined || value === null || value === '') {
      return null;
    }

    // Type validation
    if (rule.type) {
      const typeError = this.validateType(value, rule.type, rule.field);
      if (typeError) return typeError;
    }

    // String validations
    if (typeof value === 'string') {
      if (rule.minLength && value.length < rule.minLength) {
        return {
          field: rule.field,
          message: `${rule.field} must be at least ${rule.minLength} characters`,
          value,
        };
      }

      if (rule.maxLength && value.length > rule.maxLength) {
        return {
          field: rule.field,
          message: `${rule.field} must be at most ${rule.maxLength} characters`,
          value,
        };
      }

      if (rule.pattern && !rule.pattern.test(value)) {
        return {
          field: rule.field,
          message: `${rule.field} has an invalid format`,
          value,
        };
      }
    }

    // Number validations
    if (rule.type === 'number') {
      const numValue = parseFloat(value);
      if (rule.min !== undefined && numValue < rule.min) {
        return {
          field: rule.field,
          message: `${rule.field} must be at least ${rule.min}`,
          value,
        };
      }

      if (rule.max !== undefined && numValue > rule.max) {
        return {
          field: rule.field,
          message: `${rule.field} must be at most ${rule.max}`,
          value,
        };
      }
    }

    // Custom validation
    if (rule.custom) {
      const customError = rule.custom(value, row);
      if (customError) {
        return {
          field: rule.field,
          message: customError,
          value,
        };
      }
    }

    return null;
  }

  /**
   * Validate value type
   */
  private static validateType(value: any, type: string, field: string): ValidationError | null {
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          return { field, message: `${field} must be a string`, value };
        }
        break;

      case 'number':
        if (isNaN(parseFloat(value))) {
          return { field, message: `${field} must be a valid number`, value };
        }
        break;

      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(value))) {
          return { field, message: `${field} must be a valid email address`, value };
        }
        break;

      case 'date':
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          return { field, message: `${field} must be a valid date`, value };
        }
        break;

      case 'boolean':
        const boolValues = ['true', 'false', '1', '0', 'yes', 'no'];
        if (!boolValues.includes(String(value).toLowerCase())) {
          return { field, message: `${field} must be a boolean value`, value };
        }
        break;
    }

    return null;
  }

  /**
   * Validate an entire row against multiple rules
   */
  static validateRow(row: Record<string, any>, rules: ValidationRule[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const value = row[rule.field];
      const error = this.validateField(value, rule, row);
      if (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  /**
   * Common validation rules factory
   */
  static createRule(field: string, options: Partial<ValidationRule> = {}): ValidationRule {
    return {
      field,
      ...options,
    };
  }

  /**
   * Pre-built validation rules
   */
  static rules = {
    requiredString: (field: string) => this.createRule(field, { required: true, type: 'string' }),
    requiredEmail: (field: string) => this.createRule(field, { required: true, type: 'email' }),
    requiredNumber: (field: string) => this.createRule(field, { required: true, type: 'number' }),
    optionalString: (field: string) => this.createRule(field, { type: 'string' }),
    optionalNumber: (field: string) => this.createRule(field, { type: 'number' }),
    optionalEmail: (field: string) => this.createRule(field, { type: 'email' }),
  };
}
