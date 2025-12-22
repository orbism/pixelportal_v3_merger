import { FieldState } from "final-form";

export type ValidatorFunction = (value: any, allValues: Object, meta?: FieldState<any>) => any;

const required = (customString?: string) => (value: any) => {
  const stringToReturn = customString ? customString : "Required";
  return value ? undefined : stringToReturn;
};

const mustBeANumber = (value: any) => (isNaN(value) ? `Must be a number` : undefined);

const minValue = (min: any, customString?: string) => (value: any) => {
  const stringToReturn = customString ? customString : `Must be greater than ${min}`;
  return isNaN(value) || value >= min ? undefined : stringToReturn;
};

const maxValue = (max: any, customString?: string) => (value: any) => {
  const stringToReturn = customString ? customString : `Must be less than ${max}`;
  return isNaN(value) || value <= max ? undefined : stringToReturn;
};

const exactLength = (length: any) => (value: string) =>
  value.length === length ? undefined : `Must be ${length} characters long`;

const noNegativeBalances = (customString?: string) => (value: any) => {
  // const stringToReturn = customString ? customString : t`Must settle all balances before withdrawing`
  // return !AppStore.balances.userHasNegativeBalances ? undefined : stringToReturn
};

const isValidEmail = (value: any) => {
  if (!value) return undefined; // Allow empty for optional fields
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value) ? undefined : "Please enter a valid email address";
};

const atLeastOneContact = (value: any, allValues?: any) => {
  // Don't validate if allValues is not available yet
  if (!allValues) return undefined;
  
  const { email, discordUsername, telegramUsername, xUsername } = allValues;
  
  // If at least one contact field has a value, validation passes
  if (email || discordUsername || telegramUsername || xUsername) {
    return undefined;
  }
  
  // Only show error if none of the contact fields have values
  return "Please provide at least one contact method";
};

const composeValidators =
  (...validators: any[]) =>
  (value: any) =>
    validators.reduce((error, validator) => error || validator(value), undefined);

export {
  required,
  mustBeANumber,
  minValue,
  maxValue,
  exactLength,
  noNegativeBalances,
  composeValidators,
  isValidEmail,
  atLeastOneContact,
};
