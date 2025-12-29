import { Box, useColorMode } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import Modal from "../../DSL/Modal/Modal";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import Button, { ButtonVariant } from "../../DSL/Button/Button";
import { lightOrDarkMode } from "../../DSL/Theme";

interface SubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSuccess: boolean;
  ticketId?: number | null;
  errorMessage?: string;
}

const SubmissionModal = observer(({ isOpen, onClose, isSuccess, ticketId, errorMessage }: SubmissionModalProps) => {
  const { colorMode } = useColorMode();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={isSuccess ? "Ticket Submitted!" : "Submission Failed"}
    >
      <Box p={6}>
        {isSuccess ? (
          <Box textAlign="center">
            <Box mb={4}>
              <Typography variant={TVariant.PresStart24} color={lightOrDarkMode(colorMode, "green.600", "green.300")}>
                ✓
              </Typography>
            </Box>
            <Typography variant={TVariant.ComicSans16} mb={4}>
              Your support ticket <strong>#{ticketId}</strong> has been submitted successfully!
            </Typography>
            <Typography variant={TVariant.ComicSans14} opacity={0.8}>
              We'll get back to you as soon as possible.
            </Typography>
          </Box>
        ) : (
          <Box textAlign="center">
            <Box mb={4}>
              <Typography variant={TVariant.PresStart24} color={lightOrDarkMode(colorMode, "red.600", "red.300")}>
                ✗
              </Typography>
            </Box>
            <Typography variant={TVariant.ComicSans16} mb={4}>
              {errorMessage || "Something went wrong while submitting your ticket."}
            </Typography>
            <Typography variant={TVariant.ComicSans14} opacity={0.8}>
              Please try again or contact us through our social media channels.
            </Typography>
          </Box>
        )}
        
        <Box mt={6} display="flex" justifyContent="center">
          <Button variant={ButtonVariant.Primary} onClick={onClose}>
            Close
          </Button>
        </Box>
      </Box>
    </Modal>
  );
});

export default SubmissionModal;

