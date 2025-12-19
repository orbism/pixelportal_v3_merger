import { isDevModeEnabled, isStaging } from "../environment/helpers";

export const getEtherscanURL = (address: string, type: "tx" | "address") => {
  let link = `https://basescan.org/${type}/${address}`;
  if (isDevModeEnabled() || isStaging()) {
    link = `https://sepolia.basescan.org/${type}/${address}`;
  }
  return link;
};
