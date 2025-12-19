import { observer } from "mobx-react-lite";
import Icon from "../../DSL/Icon/Icon";
import Link from "../../DSL/Link/Link";
import { isDevModeEnabled, isStaging } from "../../environment/helpers";
import AppStore from "../../store/App.store";

interface OpenSeaLinkProps {
  pixelId: number | string;
  chain?: "ethereum" | "base";
}

function openseaBaseURL(chain: "ethereum" | "base", testnet: boolean) {
  if (testnet) {
    if (chain === "base") {
      return "https://testnets.opensea.io/assets/base-sepolia/";
    } else {
      return "https://testnets.opensea.io/assets/sepolia/";
    }
  } else {
    if (chain === "base") {
      return "https://opensea.io/assets/base/";
    } else {
      return "https://opensea.io/assets/ethereum/";
    }
  }
}

const OpenSeaLink: React.FC<OpenSeaLinkProps> = observer(({ pixelId, chain = "base" }) => {
  const baseURL = openseaBaseURL(chain, isDevModeEnabled() || isStaging());
  return (
    <Link opacity={0.5} target={"_blank"} size={"sm"} href={baseURL + `${AppStore.web3.pxContractAddress}/${pixelId}`}>
      <Icon fill={"white"} icon={"openSea"} boxSize={5} />
    </Link>
  );
});

export default OpenSeaLink;
