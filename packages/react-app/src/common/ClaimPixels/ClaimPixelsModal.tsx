import { Box } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import { useMemo } from "react";
import Modal from "../../DSL/Modal/Modal";
import ClaimPixelsDialog from "./ClaimPixelsDialog";
import ClaimPixelsDialogStore from "./ClaimPixelsDialog.store";

interface ClaimPixelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onCompleteClose: () => void;
}

const ClaimPixelsModal = observer(({ isOpen, onClose, onSuccess, onCompleteClose }: ClaimPixelsModalProps) => {
  const store = useMemo(() => new ClaimPixelsDialogStore(), []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Claim Your V3 Pixels"
      description="Burn v1/v2 pixels and claim them in v3"
      size="xl"
    >
      <Box>
        <ClaimPixelsDialog store={store} onSuccess={onSuccess} onCompleteClose={onCompleteClose} />
      </Box>
    </Modal>
  );
});

export default ClaimPixelsModal;