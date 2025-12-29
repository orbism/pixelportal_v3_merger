import React from "react";
import { FormErrorMessage, Textarea, useColorMode } from "@chakra-ui/react";
import Control from "./Control";
import { useControlledFormField, useFormField } from "./useFormField";
import { AllowedStyleProps, BaseInputProps } from "./interfaces";
import { lightOrDarkMode } from "../Theme";

export interface TextAreaInputProps extends BaseInputProps, AllowedStyleProps {
  rows?: number;
  resize?: "none" | "both" | "horizontal" | "vertical";
}

const TextAreaInput = React.forwardRef(
  (
    {
      name,
      placeholder,
      label,
      validate,
      initialValue,
      value,
      onChange,
      horizontal = false,
      rows = 6,
      resize = "vertical",
      ...rest
    }: TextAreaInputProps,
    ref,
  ) => {
    const { isRequired, inputValue, inputOnChange, restInput, meta } = useFormField(validate, name, initialValue);
    useControlledFormField(inputOnChange, value);
    const { colorMode } = useColorMode();

    return (
      <Control name={name} isRequired={isRequired} label={label} horizontal={horizontal}>
        <Textarea
          //@ts-ignore
          ref={ref}
          {...restInput}
          {...rest}
          id={name}
          name={name}
          placeholder={placeholder}
          rows={rows}
          resize={resize}
          value={inputValue}
          onChange={e => {
            if (onChange) {
              onChange(e.target.value);
            }
            inputOnChange(e.target.value);
          }}
          _placeholder={{ color: lightOrDarkMode(colorMode, "gray.500", "gray.400") }}
          borderWidth="1px"
          borderStyle="solid"
          borderColor={lightOrDarkMode(colorMode, "black", "white")}
          color={lightOrDarkMode(colorMode, "black", "white")}
          bg={lightOrDarkMode(colorMode, "#F1F2F3", "purple.600")}
          borderRadius="8px"
          px={6}
          py={3}
          _focus={{
            borderColor: lightOrDarkMode(colorMode, "black", "white"),
            bg: lightOrDarkMode(colorMode, "#E0E1E2", "purple.500"),
            boxShadow: "none",
            _placeholder: {
              color: "transparent",
            },
          }}
          _hover={{
            borderColor: lightOrDarkMode(colorMode, "black", "white"),
          }}
        />
        <FormErrorMessage>{meta.error}</FormErrorMessage>
      </Control>
    );
  },
);

export default TextAreaInput;

