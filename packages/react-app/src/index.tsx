import { ChakraProvider, ColorModeScript, useColorMode } from "@chakra-ui/react";
import { RainbowKitProvider, connectorsForWallets, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import * as Sentry from "@sentry/react";
import { Integrations } from "@sentry/tracing";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Colors from "./DSL/Colors/Colors";
import Fonts, { Type } from "./DSL/Fonts/Fonts";
import theme from "./DSL/Theme";
import { ToastContainer } from "./DSL/Toast/Toast";

import { CreateConfigParameters, WagmiProvider, createConfig, http } from "wagmi";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia, foundry, mainnet, sepolia, type Chain } from "wagmi/chains";
import { coinbaseWallet, magicEdenWallet } from "@rainbow-me/rainbowkit/wallets";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import envConfig from "./environment/config";

// Build chain configuration from environment
const buildTargetChain = (): Chain => {
  // Start with foundry as base for local chains
  const baseChain = envConfig.chain.id === 1337 || envConfig.chain.id === 31337 
    ? { ...foundry } 
    : {};

  return {
    ...baseChain,
    id: envConfig.chain.id,
    name: envConfig.chain.name,
    network: envConfig.chain.name.toLowerCase().replace(/\s+/g, '-'),
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [envConfig.chain.rpcUrl] },
      public: { http: [envConfig.chain.rpcUrl] },
    },
    blockExplorers: envConfig.chain.id === 8453 
      ? { default: { name: 'BaseScan', url: 'https://basescan.org' } }
      : envConfig.chain.id === 84532
      ? { default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' } }
      : undefined,
  } as Chain;
};

const targetChain = buildTargetChain();

// Only initialize Sentry in production to avoid CORS issues with Anvil
if (envConfig.isProduction && envConfig.services.sentryDsn) {
  Sentry.init({
    dsn: envConfig.services.sentryDsn,
    integrations: [new Integrations.BrowserTracing()],
    tracesSampleRate: 1.0,
  });
}

const customLightTheme = lightTheme({
  borderRadius: "none",
  fontStack: "system",
  accentColor: Colors.yellow[100],
  overlayBlur: "small",
});
customLightTheme.fonts.body = Type.ComicSans;
customLightTheme.colors.modalBackground = Colors.yellow[50];
customLightTheme.colors.modalBorder = "black";

const customDarkTheme = darkTheme({
  borderRadius: "none",
  fontStack: "system",
  accentColor: Colors.gray[300],
  overlayBlur: "small",
});
customDarkTheme.fonts.body = Type.ComicSans;
customDarkTheme.colors.modalBackground = Colors.purple[700];
customDarkTheme.colors.modalBorder = "white";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [coinbaseWallet, magicEdenWallet],
    },
  ],
  {
    appName: "Own The Doge: Pixel Portal",
    projectId: envConfig.services.walletConnectProjectId,
  },
);

const l1Chains = envConfig.isProduction ? [mainnet] : [sepolia];

const config = createConfig({
  connectors,
  chains: [targetChain as Chain, ...l1Chains],
  transports: {
    [targetChain.id]: http(),
    ...Object.fromEntries(l1Chains.map(c => [c.id, http()])),
  },
});

// const config = createConfig();

// const config = getDefaultConfig({
//   appName: "Own The Doge: Pixel Portal",
//   projectId: "573dfdb7fc28f71be6bc4e69d81fe1a6",
//   chains: [targetChain as Chain],
//   // connectors: [
//   //   coinbaseWallet({ appName: 'Own The Doge: Pixel Portal', preference: 'smartWalletOnly' }),
//   // ],
//   transports: {
//     [targetChain.id]: http(),
//   },
// });

const queryClient = new QueryClient();

const Index = () => {
  const { colorMode } = useColorMode();
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={colorMode === "light" ? customLightTheme : customDarkTheme}>
          <Fonts />
          <App />
          <ToastContainer />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

const container = document.getElementById("root");
const root = createRoot(container);

const AppContent = (
  <>
    <ColorModeScript initialColorMode={theme.config.initialColorMode} />
    <ChakraProvider theme={theme} resetCSS>
      <Index />
    </ChakraProvider>
  </>
);

// Disable StrictMode via REACT_APP_STRICT_MODE=false (enabled by default)
const useStrictMode = process.env.REACT_APP_STRICT_MODE !== 'false';

root.render(
  useStrictMode ? <React.StrictMode>{AppContent}</React.StrictMode> : AppContent,
);
