import { GlobalFont } from "../../Typography/Typography.style";
import { colorModeType, lightOrDarkMode } from "../../Theme";

export const InputStyle = {
  parts: ["field", "addon"],
  baseStyle: ({ colorMode }: { colorMode: colorModeType }) => ({
    field: {
      fontFamily: GlobalFont,
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: lightOrDarkMode(colorMode, "black", "white"),
      color: lightOrDarkMode(colorMode, "black", "white"),
      bg: lightOrDarkMode(colorMode, "#F1F2F3", "purple.600"),
      _focus: {
        bg: lightOrDarkMode(colorMode, "#E0E1E2", "purple.500"),
        _placeholder: {
          color: "transparent",
        },
      },
      // borderRadius: "0px"
    },
  }),
  variants: {
    outline: ({ colorMode }: { colorMode: colorModeType }) => ({
      field: {
        px: 6,
        py: 6,
        pl: "2em",
        borderColor: lightOrDarkMode(colorMode, "black", "white"),
        borderRadius: "50px",
        boxShadow: "none",
        bg: lightOrDarkMode(colorMode, "#F1F2F3", "purple.600"),
        _hover: {
          borderColor: lightOrDarkMode(colorMode, "black", "white"),
          boxShadow: "none",
        },
        _focus: {
          borderColor: lightOrDarkMode(colorMode, "black", "white"),
          boxShadow: "none",
          bg: lightOrDarkMode(colorMode, "#E0E1E2", "purple.500"),
        },
        _placeholder: {
          color: lightOrDarkMode(colorMode, "gray.500", "gray.400"),
        },
      },
    }),
  },
};

export default InputStyle;
