import { Box } from "@chakra-ui/react";
import { useEffect, useMemo } from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import { observer } from "mobx-react-lite";
import "./App.css";
import routes from "./App.routes";
import buildInfo from "./build_number";
import { HeaderMarquee } from "./layouts/AppLayout/AppLayout";
import AppStore from "./store/App.store";

import { useWalletClient } from "wagmi";

import envConfig from "./environment/config";
import { ethers } from "ethers";

// Use environment-driven chain configuration
const targetChain = {
  id: envConfig.chain.id,
  name: envConfig.chain.name,
};

const logAppVersionToConsole = () => {
  var styleArray = [
    "background-color: yellow",
    "background-size: cover",
    "background-repeat: no-repeat",
    "background-position: center",
    "color: magenta",
    "font-weight: bold",
    "padding: 10px 10px",
    "line-height: 60px",
    "border : 3px solid black",
    "text-align: center",
  ];
  console.log(`%cdogepixels@${buildInfo.lastHash.substring(0, 6)}`, styleArray.join("; "));
  console.log(`build hash ${buildInfo.lastHash} - no ${buildInfo.buildNumber} - date ${buildInfo.buildTime}`);
};

const useWeb3WagmiSync = () => {
  const { data: client } = useWalletClient();

  const account = useMemo(() => client && client.account, [client]);
  const chain = useMemo(() => client && client.chain, [client]);
  const transport = useMemo(() => client && client.transport, [client]);

  useEffect(() => {
    if (chain && targetChain?.id === chain?.id) {
      const network = {
        chainId: chain.id,
        name: chain.name,
      };
      const provider = new ethers.providers.Web3Provider(transport as any, network);
      const signer = provider.getSigner(account.address);
      console.log("Connecting...");
      AppStore.web3.connect(signer, chain, provider);
    }

    if (AppStore.web3.signer && !chain) {
      AppStore.web3.disconnect();
    }
  }, [targetChain, account, chain]);
};

AppStore.init();

const App = observer(() => {
  useEffect(logAppVersionToConsole, []);
  useWeb3WagmiSync();
  return (
    <>
      <Box position={"absolute"} left={0} w={"full"}>
        <HeaderMarquee />
      </Box>

      <BrowserRouter>
        <Switch>
          {routes.map((route, index) => {
            const Component = route.component;
            const Layout = route.layout;
            const Middleware = route.middleware;
            const RenderRedirect = Middleware ? Middleware(Component) : undefined;

            return (
              <Route
                path={route.path}
                exact={route.exact}
                key={route.name}
                render={props => {
                  if (RenderRedirect) {
                    return RenderRedirect;
                  } else {
                    return (
                      <Layout>
                        <Component />
                      </Layout>
                    );
                  }
                }}
              />
            );
          })}
        </Switch>
      </BrowserRouter>
    </>
  );
});

export default App;
