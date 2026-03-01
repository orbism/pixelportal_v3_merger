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
            { name: "Smoke", x: "Smoke_theArtist" },
            { name: "Path", x: "Cryptopathic" },
          ]}
        />
        <CreditsSection
          title="Development & Design"
          entries={[
            { name: "Caleb", x: "caleb__guy" },
            { name: "Orb", x: "ArtofOrb" },
            { name: "Moon", x: "TheMoonOfficia2" },
          ]}
        />
      </VStack>
    </Modal>
  );
};

export default CreditsModal;
