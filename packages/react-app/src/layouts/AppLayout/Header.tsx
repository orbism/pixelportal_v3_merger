import React, { useEffect } from "react";
import { Box, Flex, useBreakpointValue, useColorMode } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import { GiHamburgerMenu } from "react-icons/gi";
import { useHistory, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";
import { isProduction } from "../../environment/helpers";
import { base, baseSepolia } from "viem/chains";
import { NamedRoutes, route } from "../../App.routes";
import { darkModeGradient, lightOrDarkMode } from "../../DSL/Theme";

import Button, { ConnectWalletButton } from "../../DSL/Button/Button";
import ColorModeToggle from "../../DSL/ColorModeToggle/ColorModeToggle";
import DPPLogo from "../../images/logo.png";
import AppStore from "../../store/App.store";
import NavLinks from "./NavLinks";
import { ModalType } from "../../store/Modals.store";

const targetChain = isProduction() ? base : baseSepolia;

const Header = observer(() => {
  const history = useHistory();
  const location = useLocation();
  const { chain } = useAccount();
  const { colorMode } = useColorMode();
  const { isConnected, puppersOwned } = AppStore.web3;
  const isGuideModeActive = AppStore.guide.isGuideActive;
  
  const onLogoClick = useBreakpointValue({
    base: () => {
      if (isGuideModeActive) {
        AppStore.guide.skipGuide();
      } else {
        AppStore.rwd.toggleMobileNav();
      }
    },
    xl: () => {
      if (isGuideModeActive) {
        AppStore.guide.skipGuide();
      } else {
        history.push(route(NamedRoutes.VIEWER));
      }
    },
  });

  const handleMintClick = () => {
    if (location.pathname !== "/" && !location.pathname.includes("/px")) {
      history.push("/");
    }
    AppStore.modals.openModal(ModalType.Mint);
    AppStore.refreshWeb3Signer(); // Refresh or check the signer when button is clicked
  };

  useEffect(() => {
    if (!AppStore.web3.signer) {
      AppStore.web3.setSigner(AppStore.web3.provider?.getSigner());
    }
  }, []);

  useEffect(() => {
    AppStore.refreshWeb3Signer();
  }, []);

  const showHamburger = useBreakpointValue({ base: true, xl: false }, { fallback: "xl" });
  return (
    <Box>
      <Flex mb={{ base: 0, md: 6 }}>
        <Flex alignItems={"center"} w={"full"} gap={6} position={"relative"}>
          <Box
            data-guide-target="logo"
            top={{ base: 2, md: 0 }}
            left={{ base: 2, md: 0 }}
            bg={lightOrDarkMode(colorMode, "yellow.50", darkModeGradient)}
            zIndex={10010}
            position={{ base: "absolute", md: "relative" }}
            _hover={{
              cursor: "pointer",
            }}
            _active={{
              transform: "translate(4px, 4px)",
            }}
            onClick={onLogoClick}
            userSelect={"none"}
            borderWidth={1}
            borderColor={lightOrDarkMode(colorMode, "black", "white")}
            rounded={"full"}
          >
            <img src={DPPLogo} width={50} alt={"nav-dog"} />

            {showHamburger && (
              <>
                <Box
                  position={"absolute"}
                  top={0}
                  left={0}
                  w={"full"}
                  h={"full"}
                  bg={lightOrDarkMode(colorMode, "yellow.50", "purple.700")}
                  rounded={"full"}
                  opacity={0.85}
                  data-guide-target="menu-button"
                />
                <Flex
                  justifyContent={"center"}
                  alignItems={"center"}
                  position={"absolute"}
                  left={0}
                  top={0}
                  w={"full"}
                  h={"full"}
                  data-guide-target="menu-button"
                >
                  <GiHamburgerMenu color={lightOrDarkMode(colorMode, "black", "white")} size={24} />
                </Flex>
              </>
            )}
          </Box>
          <Flex gap={6} display={{ base: "none", xl: "flex" }} data-guide-target="menu-button">
            <NavLinks
              onClick={() => {
                if (AppStore.rwd.isMobileNavOpen) {
                  AppStore.rwd.toggleMobileNav();
                }
              }}
            />
          </Flex>
        </Flex>
        <Flex>
          <Box display={{ base: "none", md: "flex" }} alignItems={"center"} justifyContent={"flex-end"} w={"full"}>
            <Flex mr={8} alignItems={"center"}>
              {(AppStore.web3?.address || isGuideModeActive) && (
                <Flex alignItems={"center"}>
                  <Box data-guide-target="mint-button">
                    <Button
                      size="sm"
                      mr={8}
                      onClick={handleMintClick}
                      isDisabled={isGuideModeActive && !AppStore.web3?.address}
                    >
                      Mint
                    </Button>
                  </Box>

                  {(AppStore.web3.puppersOwned.length > 0 || isGuideModeActive) && (
                    <Box data-guide-target="burn-button">
                      <Button
                    size="sm"
                    mr={8}
                    onClick={() => {
                      if (location.pathname !== "/" && !location.pathname.includes("/px")) {
                        history.push("/");
                      }
                          AppStore.modals.openModal(ModalType.Burn);
                        }}
                        isDisabled={isGuideModeActive && AppStore.web3.puppersOwned.length === 0}
                      >
                        Burn
                  </Button>
                    </Box>
                  )}

                  <Box data-guide-target="claim-button">
                    <Button
                      size="sm"
                      mr={8}
                      onClick={() => {
                        if (location.pathname !== "/" && !location.pathname.includes("/px")) {
                          history.push("/");
                        }
                        AppStore.modals.openModal(ModalType.Claim);
                      }}
                      isDisabled={isGuideModeActive && !AppStore.web3?.address}
                    >
                      Claim
                    </Button>
                  </Box>
                </Flex>
              )}
              <Box>
                <ColorModeToggle />
              </Box>
            </Flex>

            <Box data-guide-target="wallet-button">
            <ConnectWalletButton />
            </Box>
          </Box>
        </Flex>
      </Flex>
    </Box>
  );
});

export default Header;
