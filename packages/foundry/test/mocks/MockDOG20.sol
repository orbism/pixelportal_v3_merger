// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockDOG20
 * @dev Mock DOG20 token for testing purposes
 */
contract MockDOG20 is ERC20 {
    constructor() ERC20("DOG Token", "DOG") {}

    /**
     * @dev Mint tokens to multiple addresses for testing
     * @param recipients Array of addresses to mint to
     * @param totalAmount Total amount to distribute equally
     */
    function initialize(address[] memory recipients, uint256 totalAmount) external {
        uint256 amountPerRecipient = totalAmount / recipients.length;

        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amountPerRecipient);
        }

        // Mint any remainder to the first recipient
        uint256 remainder = totalAmount % recipients.length;
        if (remainder > 0 && recipients.length > 0) {
            _mint(recipients[0], remainder);
        }
    }

    /**
     * @dev Mint tokens to a specific address
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens from a specific address
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
