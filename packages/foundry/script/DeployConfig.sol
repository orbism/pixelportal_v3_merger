// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title DeployConfig
 * @dev Configuration contract for PX deployment across different networks
 */
library DeployConfig {
    struct NetworkConfig {
        string name;
        address dog20Address;
        string ipfsUri;
        uint256 shibaWidth;
        uint256 shibaHeight;
        address devFeeAddress;
        string tokenName;
        string tokenSymbol;
    }

    /**
     * @dev Get configuration for Ethereum mainnet
     */
    function getMainnetConfig(address dog20Address) internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            name: "ethereum-mainnet",
            dog20Address: dog20Address,
            ipfsUri: "ipfs://",
            shibaWidth: 1000,
            shibaHeight: 1000,
            devFeeAddress: address(0),
            tokenName: "PX Token",
            tokenSymbol: "PX"
        });
    }

    /**
     * @dev Get configuration for Ethereum Sepolia testnet
     */
    function getSepoliaConfig(address dog20Address) internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            name: "ethereum-sepolia",
            dog20Address: dog20Address,
            ipfsUri: "ipfs://test-",
            shibaWidth: 100,
            shibaHeight: 100,
            devFeeAddress: address(0), // TODO: Set test dev fee address
            tokenName: "PX Token (Sepolia)",
            tokenSymbol: "PXT"
        });
    }

    /**
     * @dev Get configuration for Base mainnet
     */
    function getBaseMainnetConfig(address dog20Address) internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            name: "base-mainnet",
            dog20Address: dog20Address,
            ipfsUri: "ipfs://",
            shibaWidth: 1000,
            shibaHeight: 1000,
            devFeeAddress: address(0),
            tokenName: "PX Token",
            tokenSymbol: "PX"
        });
    }

    /**
     * @dev Get configuration for Base Sepolia testnet
     */
    function getBaseSepoliaConfig(address dog20Address) internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            name: "base-sepolia",
            dog20Address: dog20Address,
            ipfsUri: "ipfs://base-test-",
            shibaWidth: 100,
            shibaHeight: 100,
            devFeeAddress: address(0), // TODO: Set test dev fee address
            tokenName: "PX Token (Base Sepolia)",
            tokenSymbol: "PXBT"
        });
    }

    /**
     * @dev Get configuration for local development (Foundry node)
     */
    function getLocalConfig() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            name: "foundry-local",
            dog20Address: address(0x1111111111111111111111111111111111111111),
            ipfsUri: "ipfs://local-",
            shibaWidth: 10,
            shibaHeight: 10,
            devFeeAddress: address(0x1234567890123456789012345678901234567890),
            tokenName: "PX Token (Local)",
            tokenSymbol: "PXLOCAL"
        });
    }

    /**
     * @dev Get configuration based on chain ID
     */
    function getConfigForChainId(uint256 chainId, address dog20Address) internal pure returns (NetworkConfig memory) {
        if (chainId == 1) {
            return getMainnetConfig(dog20Address);
        } else if (chainId == 11155111) {
            return getSepoliaConfig(dog20Address);
        } else if (chainId == 8453) {
            return getBaseMainnetConfig(dog20Address);
        } else if (chainId == 84532) {
            return getBaseSepoliaConfig(dog20Address);
        } else if (chainId == 31337) {
            return getLocalConfig();
        } else {
            revert("Unsupported chain ID");
        }
    }
}
