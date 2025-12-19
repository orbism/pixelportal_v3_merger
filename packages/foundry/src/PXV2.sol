// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PX} from "./PX.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title PXV2
 * @dev EXAMPLE UPGRADE CONTRACT - FOR DEMONSTRATION PURPOSES ONLY
 *
 * This contract exists solely to demonstrate proper UUPS upgrade patterns and storage safety.
 * It is NOT intended for production use and serves as a reference implementation for:
 * - Safe storage layout preservation during upgrades
 * - Adding new functionality without breaking existing state
 * - Proper use of reinitializer patterns
 *
 * @dev Example V2 upgrade for PX token demonstrating proper upgrade patterns
 *
 * STORAGE SAFETY CHECKLIST:
 * ✅ All existing state variables preserved in exact same order
 * ✅ No existing state variables removed or modified
 * ✅ New state variables added at the end only
 * ✅ Storage gap reduced to accommodate new variables
 *
 * NEW FEATURES IN V2:
 * - Batch minting functionality
 * - Enhanced metadata with description
 * - Minting limits per transaction
 * - Emergency withdrawal functionality
 */
contract PXV2 is PX {
    uint256 public constant DOG_TO_PIXEL_SATOSHIS = 5523989899 * 10 ** 13;

    uint256 public maxMintPerTx;

    string public description;

    mapping(address => uint256) public lastMintTimestamp;

    uint256 public mintCooldown;

    bool public emergencyWithdrawalEnabled;

    uint256[44] private __gapV2;

    event BatchMint(address indexed to, uint256[] tokenIds);
    event MaxMintPerTxUpdated(uint256 oldLimit, uint256 newLimit);
    event DescriptionUpdated(string oldDescription, string newDescription);
    event MintCooldownUpdated(uint256 oldCooldown, uint256 newCooldown);
    event EmergencyWithdrawalEnabled();
    event EmergencyWithdrawalExecuted(address indexed token, uint256 amount);

    /**
     * @dev Initialize V2 features
     * @param maxMintPerTx_ Maximum mints per transaction
     * @param description_ Enhanced metadata description
     * @param mintCooldown_ Cooldown between mints per user
     */
    function initializeV2(uint256 maxMintPerTx_, string memory description_, uint256 mintCooldown_)
        external
        reinitializer(2)
    {
        maxMintPerTx = maxMintPerTx_;
        description = description_;
        mintCooldown = mintCooldown_;
        emergencyWithdrawalEnabled = false;

        emit MaxMintPerTxUpdated(0, maxMintPerTx_);
        emit DescriptionUpdated("", description_);
        emit MintCooldownUpdated(0, mintCooldown_);
    }

    /**
     * @dev Batch mint multiple puppers in a single transaction
     * @param qty Number of puppers to mint
     */
    function batchMintPuppers(uint256 qty) public whenNotPaused nonReentrant {
        require(qty > 0, "Non positive quantity");
        require(qty <= maxMintPerTx, "Exceeds max mint per transaction");
        require(qty <= puppersRemaining, "No puppers remaining");

        // Check cooldown
        require(block.timestamp >= lastMintTimestamp[_msgSender()] + mintCooldown, "Mint cooldown not elapsed");

        uint256[] memory mintedTokens = new uint256[](qty);

        for (uint256 i = 0; i < qty; ++i) {
            uint256 index = INDEX_OFFSET + randYishInRange(puppersRemaining);

            if (indexToPupper[index] == MAGIC_NULL) {
                indexToPupper[index] = index;
            }
            uint256 LAST_INDEX = INDEX_OFFSET + puppersRemaining - 1;
            if (indexToPupper[LAST_INDEX] == MAGIC_NULL) {
                indexToPupper[LAST_INDEX] = LAST_INDEX;
            }

            uint256 pupper = indexToPupper[index];
            indexToPupper[index] = indexToPupper[LAST_INDEX];
            indexToPupper[LAST_INDEX] = pupper;
            pupperToIndex[pupper] = LAST_INDEX;

            _mint(_msgSender(), pupper);
            mintedTokens[i] = pupper;
        }

        lastMintTimestamp[_msgSender()] = block.timestamp;

        DOG20.transferFrom(_msgSender(), address(this), qty * DOG_TO_PIXEL_SATOSHIS);

        emit BatchMint(_msgSender(), mintedTokens);
    }

    /**
     * @dev Enhanced token URI with description
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_exists(tokenId), "ERC721Metadata: URI query for nonexistent token");

        string memory baseURI = _baseURI();
        uint256 shard = 1 + (tokenId - INDEX_OFFSET) / 5000;

        if (bytes(baseURI).length > 0) {
            return string(
                abi.encodePacked(
                    baseURI,
                    "metadata-sh",
                    Strings.toString(shard),
                    "/",
                    "metadata-",
                    Strings.toString(tokenId),
                    ".json"
                )
            );
        }

        return "";
    }

    /**
     * @dev Get enhanced metadata including description
     */
    function getMetadata()
        external
        view
        returns (
            string memory tokenName,
            string memory tokenSymbol,
            string memory desc,
            uint256 supply,
            uint256 remaining
        )
    {
        return (name(), symbol(), description, totalSupply, puppersRemaining);
    }

    /**
     * @dev Set maximum mint per transaction
     */
    function setMaxMintPerTx(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = maxMintPerTx;
        maxMintPerTx = newLimit;
        emit MaxMintPerTxUpdated(oldLimit, newLimit);
    }

    /**
     * @dev Update description
     */
    function setDescription(string memory newDescription) external onlyRole(DEFAULT_ADMIN_ROLE) {
        string memory oldDescription = description;
        description = newDescription;
        emit DescriptionUpdated(oldDescription, newDescription);
    }

    /**
     * @dev Set mint cooldown period
     */
    function setMintCooldown(uint256 newCooldown) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldCooldown = mintCooldown;
        mintCooldown = newCooldown;
        emit MintCooldownUpdated(oldCooldown, newCooldown);
    }

    /**
     * @dev Enable emergency withdrawal (one-way, cannot be disabled)
     */
    function enableEmergencyWithdrawal() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyWithdrawalEnabled = true;
        emit EmergencyWithdrawalEnabled();
    }

    /**
     * @dev Emergency withdrawal of tokens (only if enabled)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(emergencyWithdrawalEnabled, "Emergency withdrawal not enabled");

        if (token == address(0)) {
            payable(_msgSender()).transfer(amount);
        } else {
            IERC20(token).transfer(_msgSender(), amount);
        }

        emit EmergencyWithdrawalExecuted(token, amount);
    }

    /**
     * @dev Check if user can mint (cooldown elapsed)
     */
    function canMint(address user) external view returns (bool) {
        return block.timestamp >= lastMintTimestamp[user] + mintCooldown;
    }

    /**
     * @dev Get time remaining until user can mint again
     */
    function getMintCooldownRemaining(address user) external view returns (uint256) {
        uint256 nextMintTime = lastMintTimestamp[user] + mintCooldown;
        if (block.timestamp >= nextMintTime) {
            return 0;
        }
        return nextMintTime - block.timestamp;
    }

    /**
     * @dev Get contract version
     */
    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
