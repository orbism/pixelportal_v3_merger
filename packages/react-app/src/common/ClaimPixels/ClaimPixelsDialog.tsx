import { Box, Divider, Flex, SimpleGrid, VStack, HStack, Alert, AlertIcon, useColorMode } from "@chakra-ui/react";
import { ethers } from "ethers";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import Button from "../../DSL/Button/Button";
import Form from "../../DSL/Form/Form";
import Submit from "../../DSL/Form/Submit";
import Loading from "../../DSL/Loading/Loading";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { getEtherscanURL } from "../../helpers/links";
import Link from "../../DSL/Link/Link";
import SharePixelsDialog from "../SharePixelsDialog/SharePixelsDialog";
import ClaimPixelsDialogStore, { ClaimPixelsModalView, BurnNetwork } from "./ClaimPixelsDialog.store";
import PixelPane from "../../DSL/PixelPane/PixelPane";
import { lightOrDarkMode } from "../../DSL/Theme";

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
      {store.currentView === ClaimPixelsModalView.Overview && <Overview store={store} />}
      {store.currentView === ClaimPixelsModalView.ConfirmBurn && <ConfirmBurn store={store} />}
      {store.currentView === ClaimPixelsModalView.BurningMainnet && <BurningPixels store={store} network="mainnet" />}
      {store.currentView === ClaimPixelsModalView.BurningBase && <BurningPixels store={store} network="base" />}
      {store.currentView === ClaimPixelsModalView.WaitingForConfirmation && <WaitingForConfirmation store={store} />}
      {store.currentView === ClaimPixelsModalView.ApprovingDOG && <ApprovingDOG store={store} />}
      {store.currentView === ClaimPixelsModalView.ReadyToClaim && <ReadyToClaim store={store} />}
      {store.currentView === ClaimPixelsModalView.ClaimingPixels && <ClaimingPixels store={store} />}
      {store.currentView === ClaimPixelsModalView.Complete && (
        <Complete store={store} txHash={store.txHash} onClose={onCompleteClose} />
      )}
      {store.currentView === ClaimPixelsModalView.AlreadyClaimed && (
        <AlreadyClaimed store={store} onClose={onCompleteClose} />
      )}
    </>
  );
});

// ============================================
// Overview View - Shows eligible pixels by network
// ============================================
const Overview = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  const { colorMode } = useColorMode();

  if (store.isLoading) {
    return <Loading title={"Checking eligibility..."} />;
  }

  const hasEligiblePixels = store.hasMainnetPixels || store.hasBasePixels;
  const hasClaimablePixels = store.claimablePixels.length > 0;

  if (!hasEligiblePixels && !hasClaimablePixels) {
    return (
      <Box textAlign="center" py={8}>
        <Typography variant={TVariant.PresStart20} block mb={4}>
          No Pixels to Claim
        </Typography>
        <Typography variant={TVariant.ComicSans16} block>
          You do not have any pixels from Pixel Portal v1 or v2 that are eligible for claiming.
        </Typography>
      </Box>
    );
  }

  return (
    <VStack spacing={6} align="stretch">
      {/* Header */}
      <Box textAlign="center">
        <Typography variant={TVariant.PresStart20} block>
          Claim Your Pixels
        </Typography>
        <Typography variant={TVariant.ComicSans14} block mt={2}>
          Burn your v1/v2 pixels to receive $DOG back, then claim them in v3.
        </Typography>
      </Box>

      {/* Instructions */}
      <Box
        bg={lightOrDarkMode(colorMode, "yellow.50", "purple.800")}
        p={4}
        borderRadius="md"
        border="1px solid"
        borderColor={lightOrDarkMode(colorMode, "yellow.300", "purple.500")}
      >
        <Typography variant={TVariant.ComicSans14} block fontWeight="bold" mb={2}>
          How It Works:
        </Typography>
        <VStack align="start" spacing={1}>
          <Typography variant={TVariant.ComicSans12}>
            1. Burn your pixels on each network (Ethereum &amp; Base)
          </Typography>
          <Typography variant={TVariant.ComicSans12}>
            2. Receive ~55,240 $DOG per pixel back (minus 1% fee)
          </Typography>
          <Typography variant={TVariant.ComicSans12}>
            3. Bridge your $DOG to Base if needed (via Superbridge)
          </Typography>
          <Typography variant={TVariant.ComicSans12}>
            4. Claim the same pixel IDs in v3 by locking $DOG again
          </Typography>
        </VStack>
      </Box>

      {/* Claimable Pixels Section - Show first if user has already burned */}
      {hasClaimablePixels && (
        <Box
          bg={lightOrDarkMode(colorMode, "green.50", "green.900")}
          p={4}
          borderRadius="md"
          border="2px solid"
          borderColor={lightOrDarkMode(colorMode, "green.400", "green.500")}
        >
          <HStack justify="space-between" align="center" mb={3}>
            <Box>
              <Typography variant={TVariant.PresStart14} block>
                Ready to Claim
              </Typography>
              <Typography variant={TVariant.ComicSans12} block mt={1}>
                {store.claimablePixels.length} pixel(s) ready
              </Typography>
            </Box>
            <Button onClick={() => store.pushNavigation(ClaimPixelsModalView.ReadyToClaim)}>
              Claim Now
            </Button>
          </HStack>
        </Box>
      )}

      {/* Mainnet Pixels Section */}
      {store.hasMainnetPixels && (
        <NetworkSection
          store={store}
          network="mainnet"
          title="Ethereum Mainnet (v1)"
          pixelsToBurn={store.mainnetPixelsToBurn}
          allPixels={store.eligibility.mainnet}
          burnedPixels={store.burnedMainnet}
        />
      )}

      {/* Base Pixels Section */}
      {store.hasBasePixels && (
        <NetworkSection
          store={store}
          network="base"
          title="Base (v2)"
          pixelsToBurn={store.basePixelsToBurn}
          allPixels={store.eligibility.base}
          burnedPixels={store.burnedBase}
        />
      )}

      {/* Superbridge Link */}
      {(store.burnedMainnet.length > 0 || store.hasMainnetPixels) && (
        <Box textAlign="center" mt={2}>
          <Typography variant={TVariant.ComicSans12} block>
            Need to bridge $DOG from Ethereum to Base?
          </Typography>
          <Link href={store.superbridgeUrl} isExternal>
            <Typography variant={TVariant.ComicSans14} color="blue.500">
              Use Superbridge
            </Typography>
          </Link>
        </Box>
      )}
    </VStack>
  );
});

// ============================================
// Network Section Component
// ============================================
interface NetworkSectionProps {
  store: ClaimPixelsDialogStore;
  network: BurnNetwork;
  title: string;
  pixelsToBurn: number[];
  allPixels: number[];
  burnedPixels: number[];
}

const NetworkSection = observer(({ store, network, title, pixelsToBurn, allPixels, burnedPixels }: NetworkSectionProps) => {
  const { colorMode } = useColorMode();
  const allBurned = pixelsToBurn.length === 0 && burnedPixels.length > 0;

  return (
    <Box
      p={4}
      borderRadius="md"
      border="1px solid"
      borderColor={allBurned
        ? lightOrDarkMode(colorMode, "green.300", "green.600")
        : lightOrDarkMode(colorMode, "gray.300", "purple.500")}
      bg={allBurned
        ? lightOrDarkMode(colorMode, "green.50", "green.900")
        : lightOrDarkMode(colorMode, "white", "purple.700")}
    >
      <HStack justify="space-between" align="center" mb={3}>
        <Box>
          <Typography variant={TVariant.PresStart14} block>
            {title}
          </Typography>
          <Typography variant={TVariant.ComicSans12} block mt={1}>
            {allBurned ? (
              <span style={{ color: lightOrDarkMode(colorMode, "green", "#68D391") }}>All {burnedPixels.length} pixels burned</span>
            ) : (
              `${pixelsToBurn.length} pixel(s) to burn`
            )}
          </Typography>
        </Box>
        {!allBurned && pixelsToBurn.length > 0 && (
          <Button onClick={() => store.initiateBurn(network)} colorScheme="orange">
            Burn All
          </Button>
        )}
      </HStack>

      {/* Pixel Grid Preview */}
      {pixelsToBurn.length > 0 && (
        <Box maxH="150px" overflowY="auto">
          <SimpleGrid columns={{ base: 5, md: 8 }} spacing={2}>
            {pixelsToBurn.slice(0, 16).map(tokenId => (
              <Box key={tokenId} textAlign="center">
                <PixelPane size="xs" pupper={tokenId} />
                <Typography variant={TVariant.PresStart8}>#{tokenId}</Typography>
              </Box>
            ))}
            {pixelsToBurn.length > 16 && (
              <Box display="flex" alignItems="center" justifyContent="center">
                <Typography variant={TVariant.ComicSans12}>+{pixelsToBurn.length - 16} more</Typography>
              </Box>
            )}
          </SimpleGrid>
        </Box>
      )}
    </Box>
  );
});

// ============================================
// Confirm Burn Modal
// ============================================
const ConfirmBurn = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  const { colorMode } = useColorMode();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const network = store.pendingBurnNetwork;
  const pixelCount = network === "mainnet" ? store.mainnetPixelsToBurn.length : store.basePixelsToBurn.length;
  const networkName = network === "mainnet" ? "Ethereum Mainnet" : "Base";
  const dogAmount = network === "mainnet"
    ? store.dogToReceiveFromMainnetBurn
    : store.dogToReceiveFromBaseBurn;

  return (
    <VStack spacing={6} align="stretch">
      <Box textAlign="center">
        <Typography variant={TVariant.PresStart20} block>
          Confirm Burn
        </Typography>
      </Box>

      <Alert status="warning" borderRadius="md">
        <AlertIcon />
        <Typography variant={TVariant.ComicSans14}>
          This action is irreversible. Your v{network === "mainnet" ? "1" : "2"} pixels will be permanently burned, so that you may claim them on the newer, better v3 contract!
        </Typography>
      </Alert>

      <Box bg={lightOrDarkMode(colorMode, "gray.50", "purple.800")} p={4} borderRadius="md">
        <Typography variant={TVariant.ComicSans14} block mb={2}>
          <strong>Network:</strong> {networkName}
        </Typography>
        <Typography variant={TVariant.ComicSans14} block mb={2}>
          <strong>Pixels to burn:</strong> {pixelCount}
        </Typography>
        <Typography variant={TVariant.ComicSans14} block>
          <strong>$DOG to receive:</strong> ~{store.formatDogAmount(dogAmount)} $DOG
        </Typography>
        <Typography variant={TVariant.ComicSans12} block mt={1} color="gray.500">
          (99% after 1% burn fee)
        </Typography>
      </Box>

      <Typography variant={TVariant.ComicSans14} block textAlign="center">
        Your wallet will prompt you to switch networks and confirm the transaction.
      </Typography>

      {isSubmitting ? (
        <Loading title={`Burning pixels on ${networkName}...`} showSigningHint={true} />
      ) : (
        <HStack justify="center" spacing={4}>
          <Button onClick={() => store.cancelBurn()} variant="outline">
            Cancel
          </Button>
          <Button
            onClick={() => {
              setIsSubmitting(true);
              store.confirmBurn();
            }}
            colorScheme="orange"
          >
            Burn {pixelCount} Pixels
          </Button>
        </HStack>
      )}
    </VStack>
  );
});

// ============================================
// Burning Pixels Loading State
// ============================================
const BurningPixels = observer(({ store, network }: { store: ClaimPixelsDialogStore; network: BurnNetwork }) => {
  const networkName = network === "mainnet" ? "Ethereum Mainnet" : "Base";
  const pixelCount = network === "mainnet" ? store.mainnetPixelsToBurn.length : store.basePixelsToBurn.length;

  return (
    <VStack spacing={6} align="stretch">
      <Loading
        title={`Burning pixels on ${networkName}...`}
        showSigningHint={!store.hasUserSignedTx}
      />
      <Typography variant={TVariant.ComicSans14} textAlign="center">
        Burning {pixelCount} pixel(s) on {networkName}
      </Typography>
      {store.txHash && (
        <Box textAlign="center">
          <Link href={getEtherscanURL(store.txHash, "tx")} isExternal>
            <Typography variant={TVariant.ComicSans12} color="blue.500">
              View transaction
            </Typography>
          </Link>
        </Box>
      )}
      {store.burnError && (
        <Alert status="error" borderRadius="md">
          <AlertIcon />
          <Typography variant={TVariant.ComicSans14}>{store.burnError}</Typography>
        </Alert>
      )}
    </VStack>
  );
});

// ============================================
// Waiting for Confirmation
// ============================================
const WaitingForConfirmation = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  return (
    <VStack spacing={6} align="stretch">
      <Box textAlign="center">
        <Typography variant={TVariant.PresStart20} block>
          Burn Successful!
        </Typography>
      </Box>

      <Alert status="info" borderRadius="md">
        <AlertIcon />
        <Typography variant={TVariant.ComicSans14}>
          Waiting for the system to verify your burn transaction. This may take a few minutes.
        </Typography>
      </Alert>

      <Loading title="Verifying burn..." />

      <Typography variant={TVariant.ComicSans14} textAlign="center">
        Once verified, you'll be able to claim your pixels in v3.
      </Typography>

      <Divider />

      <Box textAlign="center">
        <Typography variant={TVariant.ComicSans12} block mb={2}>
          While waiting, make sure you have $DOG on Base to claim your pixels.
        </Typography>
        <Link href={store.superbridgeUrl} isExternal>
          <Typography variant={TVariant.ComicSans14} color="blue.500">
            Bridge $DOG via Superbridge
          </Typography>
        </Link>
      </Box>
    </VStack>
  );
});

// ============================================
// Approving DOG Spend
// ============================================
const ApprovingDOG = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  return (
    <VStack spacing={6} align="center">
      <Loading title="Approving $DOG spend..." showSigningHint={true} />
      <Typography variant={TVariant.ComicSans14} textAlign="center">
        Please confirm the $DOG approval in your wallet.
      </Typography>
      <Typography variant={TVariant.ComicSans12} textAlign="center" color="gray.500">
        This allows the contract to lock your $DOG when you claim pixels.
      </Typography>
    </VStack>
  );
});

// ============================================
// Ready to Claim - All-or-nothing pixel claim
// ============================================
const ReadyToClaim = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  const { colorMode } = useColorMode();

  if (store.claimablePixels.length === 0) {
    return (
      <Box textAlign="center" py={8}>
        <Typography variant={TVariant.PresStart20} block mb={4}>
          No Pixels Ready to Claim
        </Typography>
        <Typography variant={TVariant.ComicSans16} block>
          You need to burn your v1/v2 pixels first before claiming in v3.
        </Typography>
        <Button mt={4} onClick={() => { store.destroyNavigation(); store.pushNavigation(ClaimPixelsModalView.Overview); }}>
          Back to Overview
        </Button>
      </Box>
    );
  }

  const dogBalanceFormatted = store.dogBalanceOnBase
    ? store.formatDogAmount(ethers.utils.formatEther(store.dogBalanceOnBase))
    : "Loading...";
  const dogNeededFormatted = store.formatDogAmount(store.totalDogToLockForClaim);

  return (
    <VStack spacing={4} align="stretch">
      <Box textAlign="center">
        <Typography variant={TVariant.PresStart20} block>
          Claim Your Pixels
        </Typography>
        <Typography variant={TVariant.ComicSans14} block mt={2}>
          Your burns have been verified. Claim all {store.claimablePixels.length} pixel(s) in v3.
        </Typography>
      </Box>

      {/* DOG balance status */}
      <Box bg={lightOrDarkMode(colorMode, "blue.50", "purple.800")} p={3} borderRadius="md">
        <Typography variant={TVariant.ComicSans12} block>
          <strong>Your $DOG balance:</strong> {dogBalanceFormatted} $DOG
        </Typography>
        <Typography variant={TVariant.ComicSans12} block mt={1}>
          <strong>Required to claim:</strong> {dogNeededFormatted} $DOG{" "}
          <span style={{ fontSize: "0.75em", color: "gray" }}>(55,240 $DOG per pixel)</span>
        </Typography>
      </Box>

      {/* Insufficient DOG warning */}
      {!store.hasSufficientDog && (
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          <Box>
            <Typography variant={TVariant.ComicSans14} block>
              Insufficient $DOG on Base — bridge via Superbridge first.
            </Typography>
            <Link href={store.superbridgeUrl} isExternal>
              <Typography variant={TVariant.ComicSans14} color="blue.500">
                Bridge $DOG via Superbridge →
              </Typography>
            </Link>
          </Box>
        </Alert>
      )}

      {/* Superbridge link for V1 migrators */}
      {store.eligibility.mainnet.length > 0 && store.hasSufficientDog && (
        <Box textAlign="center">
          <Typography variant={TVariant.ComicSans12} color="gray.500">
            Bridged $DOG from Ethereum?{" "}
            <Link href={store.superbridgeUrl} isExternal>
              <Typography variant={TVariant.ComicSans12} as="span" color="blue.500">
                Superbridge
              </Typography>
            </Link>
          </Typography>
        </Box>
      )}

      {/* Read-only pixel grid */}
      <Box maxH="300px" overflowY="auto">
        <SimpleGrid columns={{ base: 3, md: 4 }} spacing={3}>
          {store.claimablePixels.map(pixel => (
            <Box
              key={pixel.tokenId}
              position="relative"
              border="1px solid"
              borderColor={lightOrDarkMode(colorMode, "green.400", "green.600")}
              p={2}
              borderRadius="md"
              bg={lightOrDarkMode(colorMode, "green.50", "green.900")}
            >
              <PixelPane size="xs" pupper={pixel.tokenId} />
              <Typography variant={TVariant.PresStart10} textAlign="center" mt={1}>
                #{pixel.tokenId}
              </Typography>
            </Box>
          ))}
        </SimpleGrid>
      </Box>

      <Form onSubmit={() => store.handleClaimSubmit()}>
        <Flex justifyContent="center">
          <Submit label="Claim Your Pixels!" isDisabled={!store.canClaim} />
        </Flex>
      </Form>
    </VStack>
  );
});

// ============================================
// Claiming Pixels Loading State
// ============================================
const ClaimingPixels = observer(({ store }: { store: ClaimPixelsDialogStore }) => {
  const { claimed, total } = store.claimProgress;
  const progressLabel = total > 0 && claimed < total
    ? `Claiming ${claimed} of ${total} pixels...`
    : total > 0
      ? `Claimed ${claimed} of ${total} pixels!`
      : `Claiming ${store.selectedPixels.length} pixel(s) in v3...`;

  return (
    <VStack spacing={6}>
      <Loading title={progressLabel} showSigningHint={!store.hasUserSignedTx} />
      {store.txHash && (
        <Link href={getEtherscanURL(store.txHash, "tx")} isExternal>
          <Typography variant={TVariant.ComicSans12} color="blue.500">
            View transaction
          </Typography>
        </Link>
      )}
    </VStack>
  );
});

// ============================================
// Complete - Success State
// ============================================
const Complete = observer(
  ({ store, txHash, onClose }: { store: ClaimPixelsDialogStore; txHash: string | null; onClose: () => void }) => {
    return (
      <Box>
        <Typography variant={TVariant.PresStart28} textAlign="center" block>
          Pixels Claimed!
        </Typography>
        <Box mt={4}>
          <Typography variant={TVariant.ComicSans16} textAlign="center" block>
            Successfully claimed {store.claimedPixels.length} pixel(s) in v3!
          </Typography>
          <SharePixelsDialog action="claimed" previewPixels={store.claimedPixels} />
          <Flex justifyContent="center" mt={4}>
            {txHash && (
              <Link href={getEtherscanURL(txHash, "tx")} isExternal>
                View transaction
              </Link>
            )}
          </Flex>
          <Flex justifyContent="center" mt={3}>
            <Link href="/leaderbork/activity">
              <Typography variant={TVariant.ComicSans14} color="blue.500">
                Check your spot on the LeaderBork →
              </Typography>
            </Link>
          </Flex>
          <Flex justifyContent="center" mt={6}>
            <Button onClick={onClose}>Close</Button>
          </Flex>
        </Box>
      </Box>
    );
  },
);

// ============================================
// Already Claimed
// ============================================
const AlreadyClaimed = observer(({ store, onClose }: { store: ClaimPixelsDialogStore; onClose: () => void }) => {
  const { colorMode } = useColorMode();
  const allEligible = [...store.eligibility.mainnet, ...store.eligibility.base];

  return (
    <VStack spacing={6} align="stretch">
      <Box textAlign="center">
        <Typography variant={TVariant.PresStart20} block>
          Already Claimed!
        </Typography>
        <Typography variant={TVariant.ComicSans14} block mt={2}>
          You've already claimed your V3 pixels.
        </Typography>
      </Box>

      <Alert status="success" borderRadius="md">
        <AlertIcon />
        <Typography variant={TVariant.ComicSans14}>
          All {allEligible.length} pixel(s) from your V1/V2 migration have been successfully claimed on V3.
        </Typography>
      </Alert>

      {allEligible.length > 0 && (
        <Box
          bg={lightOrDarkMode(colorMode, "green.50", "green.900")}
          p={4}
          borderRadius="md"
          border="1px solid"
          borderColor={lightOrDarkMode(colorMode, "green.300", "green.600")}
        >
          <Typography variant={TVariant.ComicSans12} block mb={3} fontWeight="bold">
            Your claimed pixels:
          </Typography>
          <Box maxH="200px" overflowY="auto">
            <SimpleGrid columns={{ base: 4, md: 6 }} spacing={2}>
              {allEligible.map(tokenId => (
                <Box key={tokenId} textAlign="center">
                  <PixelPane size="xs" pupper={tokenId} />
                  <Typography variant={TVariant.PresStart8}>#{tokenId}</Typography>
                </Box>
              ))}
            </SimpleGrid>
          </Box>
        </Box>
      )}

      <Flex justifyContent="center" mt={2}>
        <Button onClick={onClose}>Close</Button>
      </Flex>
    </VStack>
  );
});

export default ClaimPixelsDialog;
