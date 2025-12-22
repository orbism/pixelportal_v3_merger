import { Box, Flex, useColorMode } from "@chakra-ui/react";
import Icon from "../../DSL/Icon/Icon";
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
      <Flex justifyContent="flex-end" mb={2}>
        <Box
          cursor="pointer"
          onClick={onClose}
          _hover={{ opacity: 0.7 }}
          color={lightOrDarkMode(colorMode, "black", "white")}
        >
          <Icon icon="close" boxSize={5} />
        </Box>
      </Flex>
      <Typography variant={TVariant.ComicSans16} color={lightOrDarkMode(colorMode, "black", "white")}>
        {content}
      </Typography>
    </Box>
  );
};

export default GuideModal;

