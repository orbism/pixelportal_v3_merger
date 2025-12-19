import { Box, Flex, Menu, MenuButton, MenuItem, MenuList, useColorMode, useMultiStyleConfig } from "@chakra-ui/react";
import { ethers } from "ethers";
import { observer } from "mobx-react-lite";
import { useState, useEffect } from "react";
import { generatePath, useHistory, useLocation } from "react-router-dom";
import { useAccount, useDisconnect, useBlockNumber } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import Dev from "../common/Dev";
import Link from "../DSL/Link/Link";
import { lightOrDarkMode } from "../DSL/Theme";
import { showDebugToast, showErrorToast } from "../DSL/Toast/Toast";
import Typography, { TVariant } from "../DSL/Typography/Typography";
import { formatWithThousandsSeparators } from "../helpers/numberFormatter";
import { SelectedOwnerTab } from "../pages/Leaderbork/Leaderbork.store";
import AppStore from "../store/App.store";
import { ModalType } from "../store/Modals.store";

const UserDropdown = observer(() => {
  const styles = useMultiStyleConfig("Menu", {});
  const { isConnected } = AppStore.web3;
  const history = useHistory();
  const location = useLocation();
  const { colorMode } = useColorMode();
  const [isOpen, setIsOpen] = useState(false);
  const { address, isConnecting, isDisconnected } = useAccount();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    if (address) {
      AppStore.web3.setAddress(address);
      AppStore.web3.refreshPupperBalance();
    }
  }, [address]);

  useEffect(() => {
    if (isOpen) {
      AppStore.web3.refreshPupperBalance();
    }
  }, [isOpen]);

  useEffect(() => {
    if (AppStore.web3.address && AppStore.web3.signer) {
      AppStore.web3.getDogBalance();
    }
  }, [AppStore.web3.address, AppStore.web3.signer]);

  const queryClient = useQueryClient();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  useEffect(() => {
    if (blockNumber) {
      queryClient.invalidateQueries();
    }
  }, [blockNumber, queryClient]);

  return (
    <Box>
      <Menu isOpen={isOpen} onOpen={() => setIsOpen(true)} onClose={() => setIsOpen(false)}>
        <Box position={"relative"} zIndex={1}>
          <MenuButton overflow={"hidden"}>
            <Flex alignItems={"center"} overflow={"hidden"} mx={1}>
              <Typography
                variant={TVariant.PresStart14}
                maxW={"200px"}
                overflowX={"hidden"}
                overflowWrap={"initial"}
                textOverflow={"ellipsis"}
              >
                {AppStore.web3.addressForDisplay}
                {/* {ensName || account}  */}
              </Typography>
            </Flex>
          </MenuButton>
          <Box __css={styles.drop} />
        </Box>

        <MenuList maxWidth={"fit-content"} zIndex={10000}>
          <Balances />
          <Box mt={8} px={3}>
            <Link isNav to={generatePath(`/leaderbork/:address/${SelectedOwnerTab.Wallet}`, { address: address })}>
              Profile
            </Link>
          </Box>
          <Box mt={1} px={3}>
            <Typography
              cursor={"pointer"}
              _hover={{ textDecoration: "underline" }}
              variant={TVariant.PresStart16}
              onClick={() => {
                if (location.pathname !== "/" && !location.pathname.includes("/px")) {
                  history.push("/");
                }
                AppStore.modals.openModal(ModalType.MyPixels);
                setIsOpen(false);
              }}
            >
              My Pixels
            </Typography>
          </Box>
          <MenuItem mt={4} onClick={() => disconnect()}>
            <Typography variant={TVariant.PresStart12}>Disconnect {">"}</Typography>
          </MenuItem>
          <Flex mt={1} px={3} alignItems={"center"}>
            <Typography color={lightOrDarkMode(colorMode, "yellow.100", "gray.300")} variant={TVariant.PresStart10}>
              connected: {AppStore.web3.network?.name}
            </Typography>
          </Flex>
        </MenuList>
      </Menu>
    </Box>
  );
});

const Balances = observer(function Balances() {
  return (
    <Box px={3}>
      {AppStore.web3?.address && (
        <>
          <Box>
            <Flex alignItems={"center"} justifyContent={"space-between"}>
              <Typography variant={TVariant.PresStart16}>DOG</Typography>
              <Dev>
                <Flex>
                  <Box ml={1} _hover={{ cursor: "pointer" }} onClick={async () => AppStore.web3.refreshDogBalance()}>
                    🔄
                  </Box>
                </Flex>
              </Dev>
            </Flex>
            <Typography variant={TVariant.ComicSans18} mt={1} block>
              {AppStore.web3.dogBalance !== null
                ? formatWithThousandsSeparators(AppStore.web3.dogBalanceHumanReadable)
                : "Loading..."}
            </Typography>
          </Box>
          <Box mt={4}>
            <Box>
              <Flex alignItems={"center"} justifyContent={"space-between"}>
                <Typography variant={TVariant.PresStart16}>Pixels</Typography>
                <Dev>
                  <Box onClick={async () => AppStore.web3.refreshPupperBalance()}>🔄</Box>
                </Dev>
              </Flex>
            </Box>
            <Typography variant={TVariant.ComicSans18} mt={1} block>
              {AppStore.web3.pupperBalance !== null
                ? AppStore.web3.pupperBalance === 0
                  ? "None 😕"
                  : formatWithThousandsSeparators(AppStore.web3.pupperBalance)
                : "Loading..."}
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
});

export default UserDropdown;
