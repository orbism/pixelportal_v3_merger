import { Box, Flex, useColorMode } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import AppStore from "../../store/App.store";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { lightOrDarkMode } from "../../DSL/Theme";
import GuideHighlight from "./GuideHighlight";
import GuideModal from "./GuideModal";

const GuideOverlay: React.FC = observer(() => {
  const { colorMode } = useColorMode();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [modalPosition, setModalPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const currentStep = AppStore.guide.currentGuideStep;

  useEffect(() => {
    if (!currentStep) return;

    const updateTarget = () => {
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

      const element = document.querySelector(currentStep.targetElement);
      if (element) {
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

      {/* Guide modal */}
      <GuideModal
        content={currentStep.content}
        position={modalPosition}
        onClose={handleClose}
      />
    </>
  );
});

export default GuideOverlay;

