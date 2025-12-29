# Rollback to Option B (Four-Panel Overlay)

If Option A (Z-Index Boost) has issues, follow these steps to switch to Option B:

## Option B Implementation

Replace the `GuideHighlight.tsx` component with a four-panel overlay system:

```tsx
// GuideHighlight.tsx - Option B Version
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
  const dimColor = lightOrDarkMode(colorMode, "rgba(0, 0, 0, 0.75)", "rgba(0, 0, 0, 0.85)");
  const borderColor = lightOrDarkMode(colorMode, "#FFD700", "#9F7AEA");

  return (
    <>
      {/* Top Panel */}
      <Box
        position="fixed"
        top={0}
        left={0}
        right={0}
        height={`${targetRect.top - padding}px`}
        bg={dimColor}
        zIndex={10000}
        pointerEvents="none"
      />
      
      {/* Right Panel */}
      <Box
        position="fixed"
        top={0}
        left={`${targetRect.right + padding}px`}
        right={0}
        bottom={0}
        bg={dimColor}
        zIndex={10000}
        pointerEvents="none"
      />
      
      {/* Bottom Panel */}
      <Box
        position="fixed"
        top={`${targetRect.bottom + padding}px`}
        left={0}
        right={0}
        bottom={0}
        bg={dimColor}
        zIndex={10000}
        pointerEvents="none"
      />
      
      {/* Left Panel */}
      <Box
        position="fixed"
        top={0}
        left={0}
        width={`${targetRect.left - padding}px`}
        bottom={0}
        bg={dimColor}
        zIndex={10000}
        pointerEvents="none"
      />

      {/* Highlight Border */}
      <Box
        position="fixed"
        left={`${targetRect.left - padding}px`}
        top={`${targetRect.top - padding}px`}
        width={`${targetRect.width + padding * 2}px`}
        height={`${targetRect.height + padding * 2}px`}
        border={`3px solid ${borderColor}`}
        borderRadius="4px"
        pointerEvents="none"
        zIndex={10001}
        transition="all 300ms ease-in-out"
      />
    </>
  );
};

export default GuideHighlight;
```

## Changes to GuideOverlay.tsx

Remove the z-index boost code (lines with "OPTION A" comment) from `GuideOverlay.tsx`:

```tsx
// REMOVE THESE LINES:
highlightedElement = element;
originalStyles.position = element.style.position || '';
originalStyles.zIndex = element.style.zIndex || '';

element.style.position = element.style.position || 'relative';
element.style.zIndex = '10001';

// And remove the cleanup in return statement:
if (highlightedElement) {
  highlightedElement.style.position = originalStyles.position;
  highlightedElement.style.zIndex = originalStyles.zIndex;
}
```

## That's it!

Option B creates true cutouts and doesn't rely on z-index manipulation at all.

