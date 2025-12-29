import { Box, Checkbox, Flex, SimpleGrid } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import Button from "../../DSL/Button/Button";
import Form from "../../DSL/Form/Form";
import Submit from "../../DSL/Form/Submit";
import Loading from "../../DSL/Loading/Loading";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { getEtherscanURL } from "../../helpers/links";
import Link from "../../DSL/Link/Link";
import SharePixelsDialog from "../SharePixelsDialog/SharePixelsDialog";
import ClaimPixelsDialogStore, { ClaimPixelsModalView } from "./ClaimPixelsDialog.store";
import PixelPane from "../../DSL/PixelPane/PixelPane";

interface ClaimPixelsDialogProps {
  store: ClaimPixelsDialogStore;
  onSuccess: () => void;
  onCompleteClose: () => void;
}

const ClaimPixelsDialog = observer(({ store, onSuccess, onCompleteClose }: ClaimPixelsDialogProps) => {
  useEffect(() => {
    store.init();
    return () => {
      store.destroy();
    };
  }, [store]);

  useEffect(() => {
    if (store.currentView === ClaimPixelsModalView.Complete) {
      onSuccess && onSuccess();
    }
  }, [store.currentView, onSuccess]);

  return (
    <>
      {store.currentView === ClaimPixelsModalView.SelectPixels && <SelectPixels store={store} />}
      {store.currentView === ClaimPixelsModalView.LoadingClaim && <LoadingClaim store={store} />}
      {store.currentView === ClaimPixelsModalView.Complete && (
        <Complete store={store} txHash={store.txHash} onClose={onCompleteClose} />
      )}
    </>
  );
});

const SelectPixels = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  if (store.isLoading) {
    return <Loading title={"Loading claimable pixels..."} />;
  }

  if (store.claimablePixels.length === 0) {
    return (
      <Box textAlign="center" py={8}>
        <Typography variant={TVariant.PresStart20} block mb={4}>
          No Pixels to Claim
        </Typography>
        <Typography variant={TVariant.ComicSans16} block>
          You do not have any pixels from Pixel Portal v1 or v2 that you have burned.
        </Typography>
      </Box>
    );
  }

  return (
    <Flex flexDirection="column">
      <Box mb={4}>
        <Typography variant={TVariant.PresStart20} block textAlign="center">
          Claim Your Pixels
        </Typography>
        <Typography variant={TVariant.ComicSans14} block textAlign="center" mt={2}>
          You have successfully burned your Pixels on v1 or v2 of the Portal. <br/>
          You can now claim those very pixels here in the new and improved v3!
        </Typography>
      </Box>

      <Flex justifyContent="space-between" mb={4}>
        <Button size="sm" onClick={() => store.selectAll()} isDisabled={store.selectedPixels.length === store.claimablePixels.length}>
          Select All
        </Button>
        <Button size="sm" onClick={() => store.deselectAll()} isDisabled={store.selectedPixels.length === 0}>
          Deselect All
        </Button>
      </Flex>

      <Box maxH="400px" overflowY="auto" mb={4}>
        <SimpleGrid columns={{ base: 3, md: 4 }} spacing={3}>
          {store.claimablePixels.map(pixel => {
            const isSelected = store.selectedPixels.includes(pixel.tokenId);
            return (
              <Box
                key={pixel.tokenId}
                onClick={() => store.togglePixelSelection(pixel.tokenId)}
                cursor="pointer"
                position="relative"
                border={isSelected ? "3px solid" : "1px solid"}
                borderColor={isSelected ? "green.500" : "gray.300"}
                p={2}
                borderRadius="md"
                _hover={{ borderColor: "green.400" }}
              >
                <Checkbox
                  isChecked={isSelected}
                  onChange={() => store.togglePixelSelection(pixel.tokenId)}
                  position="absolute"
                  top={1}
                  right={1}
                  zIndex={1}
                />
                <PixelPane size="xs" pupper={pixel.tokenId} />
                <Typography variant={TVariant.PresStart10} textAlign="center" mt={1}>
                  #{pixel.tokenId}
                </Typography>
              </Box>
            );
          })}
        </SimpleGrid>
      </Box>

      <Box textAlign="center" mb={4}>
        <Typography variant={TVariant.ComicSans14}>
          Selected: {store.selectedPixels.length} / {store.claimablePixels.length}
        </Typography>
      </Box>

      <Form onSubmit={() => store.handleClaimSubmit()}>
        <Flex justifyContent="center">
          <Submit label="Claim Selected" isDisabled={!store.canClaim} />
        </Flex>
      </Form>
    </Flex>
  );
});

const LoadingClaim = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  useEffect(() => {
    store.claimSelectedPixels();
  }, [store]);

  return (
    <Box>
      <Loading title="Claiming pixels..." showSigningHint={!store.hasUserSignedTx} />
      <Typography variant={TVariant.ComicSans14} textAlign="center" mt={4}>
        Claiming {store.selectedPixels.length} pixel(s)...
      </Typography>
    </Box>
  );
});

const Complete = observer(
  ({ store, txHash, onClose }: { store: ClaimPixelsDialogStore; txHash: string | null; onClose: () => void }) => {
    return (
      <Box>
        <Typography variant={TVariant.PresStart28} textAlign="center" block>
          Pixels Claimed!
        </Typography>
        <Typography variant={TVariant.PresStart28} textAlign="center" mt={4} block>
          🎉🎉🎉
        </Typography>
        <Box mt={4}>
          <Typography variant={TVariant.ComicSans16} textAlign="center" block>
            Successfully claimed {store.claimedPixels.length} pixel(s)
          </Typography>
          <SharePixelsDialog action="claim" previewPixels={store.claimedPixels} />
          <Flex justifyContent="center" mt={4}>
            {txHash && (
              <Link href={getEtherscanURL(txHash, "tx")} isExternal>
                View transaction
              </Link>
            )}
          </Flex>
          <Flex justifyContent="center" mt={6}>
            <Button onClick={onClose}>Close</Button>
          </Flex>
        </Box>
      </Box>
    );
  },
);

export default ClaimPixelsDialog;

