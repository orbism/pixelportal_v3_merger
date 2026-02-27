import { Box, VStack, Text, useColorMode } from "@chakra-ui/react";
import { useState } from "react";
import Modal from "../../DSL/Modal/Modal";
import Form from "../../DSL/Form/Form";
import TextInput from "../../DSL/Form/TextInput";
import TextAreaInput from "../../DSL/Form/TextAreaInput";
import Submit from "../../DSL/Form/Submit";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { required, isValidEmail } from "../../DSL/Form/validation";
import { lightOrDarkMode } from "../../DSL/Theme";

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewState = "form" | "success" | "error";

const BugReportModal = ({ isOpen, onClose }: BugReportModalProps) => {
  const [view, setView] = useState<ViewState>("form");
  const { colorMode } = useColorMode();

  const handleClose = () => {
    setView("form");
    onClose();
  };

  const handleSubmit = async (values: any) => {
    try {
      const res = await fetch("/api/send-bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          email: values.email || undefined,
          walletAddress: values.walletAddress || undefined,
          discordUsername: values.discordUsername || undefined,
          telegramUsername: values.telegramUsername || undefined,
          message: values.message,
        }),
      });
      if (!res.ok) throw new Error("Request failed");
      setView("success");
    } catch {
      setView("error");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Bug Report" size="lg">
      {view === "form" && (
        <Form onSubmit={handleSubmit}>
          <VStack spacing={3} align="stretch">
            <TextInput name="name" label="Name" placeholder="Your name" validate={required()} />
            <TextInput name="email" label="Email (optional)" placeholder="you@example.com" validate={isValidEmail} />
            <TextInput name="walletAddress" label="Wallet Address (optional)" placeholder="0x..." />
            <TextInput name="discordUsername" label="Discord (optional)" placeholder="username#1234" />
            <TextInput name="telegramUsername" label="Telegram (optional)" placeholder="@username" />
            <TextAreaInput
              name="message"
              label="What happened?"
              placeholder="What were you doing? What happened? What did you expect?"
              validate={required()}
              rows={5}
            />
            <Box pt={2}>
              <Submit label="Send Report" />
            </Box>
          </VStack>
        </Form>
      )}

      {view === "success" && (
        <VStack spacing={4} py={4} textAlign="center">
          <Typography variant={TVariant.ComicSans18}>Thank you!</Typography>
          <Typography variant={TVariant.ComicSans14}>
            Your bug report has been submitted. We'll look into it as soon as possible.
          </Typography>
        </VStack>
      )}

      {view === "error" && (
        <VStack spacing={4} py={4} textAlign="center">
          <Typography variant={TVariant.ComicSans18}>Something went wrong</Typography>
          <Typography variant={TVariant.ComicSans14}>
            We couldn't submit your report. Please try reaching out directly:
          </Typography>
          <VStack spacing={1}>
            <Text>
              <a
                href="https://discord.gg/invite/ownthedoge"
                target="_blank"
                rel="noreferrer"
                style={{ color: lightOrDarkMode(colorMode, "#5865F2", "#7289DA"), textDecoration: "underline" }}
              >
                Discord
              </a>
            </Text>
            <Text>
              <a
                href="https://t.me/ownthedoge"
                target="_blank"
                rel="noreferrer"
                style={{ color: lightOrDarkMode(colorMode, "#0088cc", "#29B6F6"), textDecoration: "underline" }}
              >
                Telegram
              </a>
            </Text>
          </VStack>
        </VStack>
      )}
    </Modal>
  );
};

export default BugReportModal;
