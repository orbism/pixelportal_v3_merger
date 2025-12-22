import { Box, Flex, useColorMode } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import AppStore from "../../store/App.store";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { lightOrDarkMode } from "../../DSL/Theme";
import GuideHighlight from "./GuideHighlight";
import GuideModal from "./GuideModal";
import DPPLogo from "../../images/logo.png";

const GuideOverlay: React.FC = observer(() => {
  const { colorMode } = useColorMode();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [modalPosition, setModalPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const currentStep = AppStore.guide.currentGuideStep;

  useEffect(() => {
    if (!currentStep) return;

    let highlightedElement: HTMLElement | null = null;
    let logoElement: HTMLElement | null = null;
    let originalStyles: { position: string; zIndex: string; pointerEvents: string } = { 
      position: '', 
      zIndex: '', 
      pointerEvents: '' 
    };
    let originalLogoStyles: { zIndex: string; pointerEvents: string } = { 
      zIndex: '', 
      pointerEvents: '' 
    };
    let originalBodyPointerEvents = '';

    const updateTarget = () => {
      // OPTION 1B: Always boost logo z-index and enable pointer events
      logoElement = document.querySelector('[data-guide-target="logo"]') as HTMLElement;
      if (logoElement) {
        originalLogoStyles.zIndex = logoElement.style.zIndex || '';
        originalLogoStyles.pointerEvents = logoElement.style.pointerEvents || '';
        logoElement.style.zIndex = '10015';
        logoElement.style.pointerEvents = 'auto';
      }

      // OPTION 2A: Block all pointer events on body
      originalBodyPointerEvents = document.body.style.pointerEvents || '';
      document.body.style.pointerEvents = 'none';

      // Special handling for 'body' (welcome step)
      if (currentStep.targetElement === 'body') {
        setTargetRect(null);
        // Center the modal
        setModalPosition({
          x: window.innerWidth / 2 - 160, // 160 is half of maxW 320px
          y: window.innerHeight / 2 - 100,
        });
        return;
      }

      const element = document.querySelector(currentStep.targetElement) as HTMLElement;
      if (element) {
        // OPTION A: Z-Index Boost - Store reference and boost z-index
        highlightedElement = element;
        originalStyles.position = element.style.position || '';
        originalStyles.zIndex = element.style.zIndex || '';
        originalStyles.pointerEvents = element.style.pointerEvents || '';
        
        // Boost z-index to appear above overlay
        element.style.position = element.style.position || 'relative';
        element.style.zIndex = '10001';
        // OPTION 2A: Enable pointer events on highlighted element
        element.style.pointerEvents = 'auto';

        const rect = element.getBoundingClientRect();
        setTargetRect(rect);

        // Calculate modal position based on modalPosition prop
        let x = 0;
        let y = 0;

        switch (currentStep.modalPosition) {
          case 'top-left':
            x = rect.left;
            y = rect.bottom + 16;
            break;
          case 'top-right':
            x = rect.right - 320; // 320 is modal maxW
            y = rect.bottom + 16;
            break;
          case 'center':
            x = window.innerWidth / 2 - 160;
            y = window.innerHeight / 2 - 100;
            break;
          case 'bottom':
            x = rect.left + (rect.width / 2) - 160;
            y = rect.top - 120;
            break;
        }

        // Apply custom offset if provided
        if (currentStep.modalOffset) {
          x += currentStep.modalOffset.x;
          y += currentStep.modalOffset.y;
        }

        // Ensure modal stays within viewport
        x = Math.max(16, Math.min(x, window.innerWidth - 336)); // 320 + 16 padding
        y = Math.max(16, Math.min(y, window.innerHeight - 200));

        setModalPosition({ x, y });
      }
    };

    // Special case: open info modal for step 2
    if (currentStep.id === 'info-modal' && !AppStore.modals.isInfoModalOpen) {
      AppStore.modals.toggleInfoModal();
    }

    updateTarget();
    window.addEventListener('resize', updateTarget);
    window.addEventListener('scroll', updateTarget);

    return () => {
      // Cleanup: restore original styles
      if (highlightedElement) {
        highlightedElement.style.position = originalStyles.position;
        highlightedElement.style.zIndex = originalStyles.zIndex;
        highlightedElement.style.pointerEvents = originalStyles.pointerEvents;
      }
      if (logoElement) {
        logoElement.style.zIndex = originalLogoStyles.zIndex;
        logoElement.style.pointerEvents = originalLogoStyles.pointerEvents;
      }
      document.body.style.pointerEvents = originalBodyPointerEvents;
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('scroll', updateTarget);
    };
  }, [currentStep]);

  const handleClose = () => {
    AppStore.guide.nextStep();
  };

  // Show final "LFD" message
  if (AppStore.guide.showFinalMessage) {
    return (
      <Flex
        position="fixed"
        top={0}
        left={0}
        right={0}
        bottom={0}
        zIndex={10000}
        justifyContent="center"
        alignItems="center"
        bg="rgba(0, 0, 0, 0.9)"
        pointerEvents="none"
      >
        <Typography
          variant={TVariant.PresStart28}
          color={lightOrDarkMode(colorMode, "#FFD700", "#9F7AEA")}
          style={{
            animation: "fadeInOut 2s ease-in-out",
          }}
        >
          L F D
        </Typography>
        <style>
          {`
            @keyframes fadeInOut {
              0% { opacity: 0; transform: scale(0.8); }
              50% { opacity: 1; transform: scale(1); }
              100% { opacity: 0; transform: scale(0.8); }
            }
          `}
        </style>
      </Flex>
    );
  }

  if (!currentStep) return null;

  return (
    <>
      {/* Highlight overlay - only for non-body targets */}
      {currentStep.targetElement !== 'body' && (
        <GuideHighlight targetRect={targetRect} showLogo={currentStep.showLogo} />
      )}
      
      {/* Full dim overlay for body/welcome step */}
      {currentStep.targetElement === 'body' && (
        <Box
          position="fixed"
          top={0}
          left={0}
          right={0}
          bottom={0}
          bg={lightOrDarkMode(colorMode, "rgba(0, 0, 0, 0.75)", "rgba(0, 0, 0, 0.85)")}
          zIndex={10000}
          pointerEvents="none"
        />
      )}

      {/* EXIT GUIDE Badge - Option 1B */}
      <Flex
        position="fixed"
        top="60px"
        left="20px"
        zIndex={10015}
        bg={lightOrDarkMode(colorMode, "yellow.50", "purple.700")}
        border="2px solid"
        borderColor={lightOrDarkMode(colorMode, "black", "white")}
        borderRadius="8px"
        px={3}
        py={2}
        alignItems="center"
        gap={2}
        cursor="pointer"
        onClick={() => AppStore.guide.skipGuide()}
        pointerEvents="auto"
        boxShadow="0 4px 12px rgba(0, 0, 0, 0.4)"
        _hover={{
          transform: "translateY(-2px)",
          boxShadow: "0 6px 16px rgba(0, 0, 0, 0.5)",
        }}
        _active={{
          transform: "translateY(0px)",
        }}
        transition="all 200ms ease-in-out"
        style={{
          animation: "subtlePulse 2s ease-in-out infinite",
        }}
      >
        <Box
          borderRadius="full"
          overflow="hidden"
          borderWidth={1}
          borderColor={lightOrDarkMode(colorMode, "black", "white")}
        >
          <img src={DPPLogo} width={32} height={32} alt="Exit Guide" />
        </Box>
        <Typography
          variant={TVariant.PresStart10}
          color={lightOrDarkMode(colorMode, "black", "white")}
          whiteSpace="nowrap"
        >
          Click to Exit
        </Typography>
      </Flex>

      {/* Guide modal */}
      <GuideModal
        content={currentStep.content}
        position={modalPosition}
        onClose={handleClose}
      />

      {/* Subtle pulse animation for EXIT badge */}
      <style>
        {`
          @keyframes subtlePulse {
            0%, 100% { 
              opacity: 1;
              transform: scale(1);
            }
            50% { 
              opacity: 0.95;
              transform: scale(1.02);
            }
          }
        `}
      </style>
    </>
  );
});

export default GuideOverlay;

