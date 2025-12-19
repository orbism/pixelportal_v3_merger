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
import { base, baseSepolia, type Chain } from "wagmi/chains";
import { coinbaseWallet, magicEdenWallet } from "@rainbow-me/rainbowkit/wallets";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { isProduction } from "./environment/helpers";

const targetChain = isProduction() ? base : baseSepolia;

Sentry.init({
  dsn: process.env.REACT_APP_SENTRY_DSN,
  integrations: [new Integrations.BrowserTracing()],
  tracesSampleRate: 1.0,
});

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
    projectId: process.env.REACT_APP_WALLETCONNECT_PROJECTID,
  },
);

const config = createConfig({
  connectors,
  chains: [targetChain as Chain],
  transports: {
    [targetChain.id]: http(),
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
root.render(
  <React.StrictMode>
    <>
      <ColorModeScript initialColorMode={theme.config.initialColorMode} />
      <ChakraProvider theme={theme} resetCSS>
        <Index />
      </ChakraProvider>
    </>
  </React.StrictMode>,
);
