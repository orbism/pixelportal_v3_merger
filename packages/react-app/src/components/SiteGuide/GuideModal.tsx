import { Box, Flex, useColorMode } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import { lightOrDarkMode } from "../../DSL/Theme";
import Typography, { TVariant } from "../../DSL/Typography/Typography";

interface GuideModalProps {
  content: string;
  position: { x: number; y: number };
  onClose: () => void;
}

const GuideModal: React.FC<GuideModalProps> = ({ content, position, onClose }) => {
  const { colorMode } = useColorMode();

  return (
    <Box
      position="fixed"
      left={`${position.x}px`}
      top={`${position.y}px`}
      maxW="320px"
      zIndex={10002}
      bg={lightOrDarkMode(colorMode, "yellow.50", "purple.700")}
      border="2px solid"
      borderColor={lightOrDarkMode(colorMode, "black", "white")}
      p={4}
      pointerEvents="auto"
      boxShadow="0 4px 12px rgba(0, 0, 0, 0.3)"
    >
      <Typography variant={TVariant.ComicSans16} color={lightOrDarkMode(colorMode, "black", "white")}>
        {content}
      </Typography>
      <Flex justifyContent="flex-end" mt={4}>
        <Flex
          alignItems="center"
          gap={2}
          cursor="pointer"
          onClick={onClose}
          _hover={{ opacity: 0.7 }}
          color={lightOrDarkMode(colorMode, "black", "white")}
        >
          <Typography variant={TVariant.PresStart10} color={lightOrDarkMode(colorMode, "black", "white")}>
            Next
          </Typography>
          <FontAwesomeIcon icon={faArrowRight} size="sm" />
        </Flex>
      </Flex>
    </Box>
  );
};

export default GuideModal;

