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
    <Modal isOpen={isOpen} onClose={onClose} title="Claim Pixels" description="Claim your reserved pixels from V1/V2">
      <Box>
        <ClaimPixelsDialog store={store} onSuccess={onSuccess} onCompleteClose={onCompleteClose} />
      </Box>
    </Modal>
  );
});

export default ClaimPixelsModal;

