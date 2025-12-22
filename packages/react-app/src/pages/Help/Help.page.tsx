import { Box, Flex, useColorMode, VStack } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import { useMemo, useState } from "react";
import { Form } from "react-final-form";
import Button, { ButtonVariant } from "../../DSL/Button/Button";
import TextInput from "../../DSL/Form/TextInput";
import TextAreaInput from "../../DSL/Form/TextAreaInput";
import { composeValidators, isValidEmail, required } from "../../DSL/Form/validation";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { lightOrDarkMode } from "../../DSL/Theme";
import HelpStore, { SubmissionStatus } from "./Help.store";
import axios from "axios";
import env from "../../environment";

interface HelpFormValues {
  email?: string;
  discordUsername?: string;
  telegramUsername?: string;
  xUsername?: string;
  message: string;
}

// Form-level validation to ensure at least one contact method
const validateForm = (values: HelpFormValues) => {
  console.log("Form validation called with:", values);
  const errors: any = {};
  
  // Check if at least one contact method is provided
  if (!values.email && !values.discordUsername && !values.telegramUsername && !values.xUsername) {
    const errorMsg = "Please provide at least one contact method";
    errors.email = errorMsg;
    errors.discordUsername = errorMsg;
    errors.telegramUsername = errorMsg;
    errors.xUsername = errorMsg;
    console.log("Validation failed: No contact method provided");
  } else {
    console.log("Validation passed: At least one contact method provided");
  }
  
  console.log("Validation errors:", errors);
  return errors;
};

const HelpPage = observer(() => {
  const store = useMemo(() => new HelpStore(), []);
  const { colorMode } = useColorMode();
  const [formKey, setFormKey] = useState(0);

  const onSubmit = async (values: HelpFormValues) => {
    console.log("=== FORM SUBMIT CALLED ===");
    console.log("Form values:", values);
    console.log("API URL:", `${env.api.baseURL}/v1/support/ticket`);
    
    store.setSubmissionStatus(SubmissionStatus.SUBMITTING);
    store.setErrorMessage("");

    try {
      console.log("Sending POST request...");
      const response = await axios.post(`${env.api.baseURL}/v1/support/ticket`, {
        email: values.email || undefined,
        discordUsername: values.discordUsername || undefined,
        telegramUsername: values.telegramUsername || undefined,
        xUsername: values.xUsername || undefined,
        message: values.message,
      });

      console.log("Response received:", response.data);
      
      if (response.data.success) {
        console.log("✓ Success! Ticket ID:", response.data.ticketId);
        store.setTicketId(response.data.ticketId);
        store.setSubmissionStatus(SubmissionStatus.SUCCESS);
        // Reset form by changing key
        setFormKey(prev => prev + 1);
      } else {
        console.error("✗ Response success was false");
        throw new Error("Submission failed");
      }
    } catch (error: any) {
      console.error("✗ Error submitting support ticket:", error);
      console.error("Error details:", error.response?.data);
      const errorMsg =
        error.response?.data?.message || error.message || "Failed to submit support ticket. Please try again.";
      store.setErrorMessage(errorMsg);
      store.setSubmissionStatus(SubmissionStatus.ERROR);
    }
  };

  return (
    <Box w={"full"} mt={6} p={{ base: 8, md: 0 }}>
      <Typography mb={4} block textAlign={"center"} variant={TVariant.PresStart24}>
        Help & Support
      </Typography>
      <Flex justifyContent={"center"}>
        <Box maxW={"3xl"} w={"full"}>
          <Box textAlign={"center"} mb={8}>
            <Typography variant={TVariant.ComicSans16}>
              Need help? Have questions? Submit a support ticket and our team will get back to you as soon as possible.
              Please provide at least one way for us to contact you.
            </Typography>
          </Box>

          {store.submissionStatus === SubmissionStatus.SUCCESS && (
            <Box
              mb={6}
              p={6}
              borderWidth={1}
              borderColor={lightOrDarkMode(colorMode, "green.500", "green.300")}
              bg={lightOrDarkMode(colorMode, "green.50", "green.900")}
              borderRadius="8px"
            >
              <Typography variant={TVariant.PresStart16} color={lightOrDarkMode(colorMode, "green.700", "green.200")}>
                ✓ Ticket Submitted!
              </Typography>
              <Typography
                mt={2}
                variant={TVariant.ComicSans14}
                color={lightOrDarkMode(colorMode, "green.600", "green.300")}
              >
                Your support ticket #{store.ticketId} has been submitted successfully. We'll get back to you soon!
              </Typography>
            </Box>
          )}

          {store.submissionStatus === SubmissionStatus.ERROR && (
            <Box
              mb={6}
              p={6}
              borderWidth={1}
              borderColor={lightOrDarkMode(colorMode, "red.500", "red.300")}
              bg={lightOrDarkMode(colorMode, "red.50", "red.900")}
              borderRadius="8px"
            >
              <Typography variant={TVariant.PresStart16} color={lightOrDarkMode(colorMode, "red.700", "red.200")}>
                ✗ Submission Failed
              </Typography>
              <Typography mt={2} variant={TVariant.ComicSans14} color={lightOrDarkMode(colorMode, "red.600", "red.300")}>
                {store.errorMessage}
              </Typography>
            </Box>
          )}

          <Form
            key={formKey}
            onSubmit={onSubmit}
            validate={validateForm}
            render={({ handleSubmit, submitting, pristine, hasValidationErrors, errors }) => {
              console.log("Form render - submitting:", submitting, "hasValidationErrors:", hasValidationErrors, "errors:", errors);
              return (
              <form onSubmit={handleSubmit}>
                <VStack spacing={6} align={"stretch"}>
                  <Box>
                    <Typography variant={TVariant.PresStart14} mb={3}>
                      Contact Information (at least one required):
                    </Typography>
                    <VStack spacing={4} align={"stretch"}>
                      <TextInput
                        name="email"
                        placeholder="your@email.com"
                        label="Email"
                        validate={isValidEmail}
                      />
                      <TextInput
                        name="discordUsername"
                        placeholder="YourDiscordName#1234"
                        label="Discord Username"
                      />
                      <TextInput
                        name="telegramUsername"
                        placeholder="@yourtelegram"
                        label="Telegram Username"
                      />
                      <TextInput
                        name="xUsername"
                        placeholder="@yourhandle"
                        label="X (Twitter) Username"
                      />
                    </VStack>
                  </Box>

                  <Box>
                    <TextAreaInput
                      name="message"
                      placeholder="Describe your issue or question in detail..."
                      label="Message"
                      validate={required("Please enter a message")}
                      rows={8}
                    />
                  </Box>

                  <Flex justifyContent={"center"} mt={4}>
                    <Button
                      submit
                      variant={ButtonVariant.Primary}
                      size="lg"
                      isDisabled={submitting || store.submissionStatus === SubmissionStatus.SUBMITTING}
                    >
                      {store.submissionStatus === SubmissionStatus.SUBMITTING ? "Submitting..." : "Submit Ticket"}
                    </Button>
                  </Flex>
                </VStack>
              </form>
            );
            }}
          />
        </Box>
      </Flex>
    </Box>
  );
});

export default HelpPage;

