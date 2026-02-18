import { Box } from "@chakra-ui/react";
import { useColorMode } from "@chakra-ui/react";
import { lightOrDarkMode } from "../../DSL/Theme";

interface GuideHighlightProps {
  targetRect: DOMRect | null;
  showLogo: boolean;
}

const GuideHighlight: React.FC<GuideHighlightProps> = ({ targetRect, showLogo }) => {
  const { colorMode } = useColorMode();

  if (!targetRect) return null;

  const padding = 8;
  const highlightStyle = {
    position: "absolute" as const,
    left: `${targetRect.left - padding}px`,
    top: `${targetRect.top - padding}px`,
    width: `${targetRect.width + padding * 2}px`,
    height: `${targetRect.height + padding * 2}px`,
    border: `3px solid ${lightOrDarkMode(colorMode, "#FFD700", "#9F7AEA")}`,
    borderRadius: "4px",
    pointerEvents: "none" as const,
    zIndex: 10001,
    boxShadow: `0 0 0 9999px ${lightOrDarkMode(colorMode, "rgba(0, 0, 0, 0.75)", "rgba(0, 0, 0, 0.85)")}`,
    transition: "all 300ms ease-in-out",
  };

  return <Box sx={highlightStyle} />;
};

export default GuideHighlight;

