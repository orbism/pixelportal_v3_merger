import { Box, VStack, HStack, useColorMode } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXTwitter } from "@fortawesome/free-brands-svg-icons";
import Modal from "../../DSL/Modal/Modal";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { lightOrDarkMode } from "../../DSL/Theme";

interface CreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CreditEntry = ({ name, x }: { name: string; x?: string }) => {
  const { colorMode } = useColorMode();
  return (
    <HStack spacing={2}>
      <Typography variant={TVariant.ComicSans14}>{name}</Typography>
      {x && (
        <a
          href={`https://x.com/${x}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: lightOrDarkMode(colorMode, "#302D25", "white"), display: "flex", alignItems: "center" }}
        >
          <FontAwesomeIcon icon={faXTwitter} size="sm" />
        </a>
      )}
    </HStack>
  );
};

const CreditsSection = ({ title, entries }: { title: string; entries: { name: string; x?: string }[] }) => (
  <Box>
    <Typography variant={TVariant.ComicSans16} mb={2} opacity={0.6}>
      {title}
    </Typography>
    <VStack spacing={1} align="stretch" pl={2}>
      {entries.map(entry => (
        <CreditEntry key={entry.name} {...entry} />
      ))}
    </VStack>
  </Box>
);

const CreditsModal = ({ isOpen, onClose }: CreditsModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Credits" size="xl">
      <VStack spacing={5} align="stretch" py={2}>
        <CreditsSection
          title="Direction"
          entries={[
            { name: "Tridog", x: "Tridogdoteth" },
          ]}
        />
        <CreditsSection
          title="Design"
          entries={[
            { name: "Your Name Here" },
          ]}
        />
        <CreditsSection
          title="Development"
          entries={[
            { name: "Your Name Here" },
          ]}
        />
      </VStack>
    </Modal>
  );
};

export default CreditsModal;
