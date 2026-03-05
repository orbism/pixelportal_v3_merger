// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.3.2 (token/ERC20/ERC20.sol)

pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ERC721CustomUpgradeable, ERC721MetadataURIQueryForNonexistentToken} from "./ERC721CustomUpgradeable.sol";

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

error NoPuppersRemainingToMint();
error PupperIsMagic();
error PupperIsNotYours();
error CannotExceedTotalSupply();
error NoPuppersRemainingForMigration();
error TokenNotAvailableForMinting();
error NoPuppersRemainingForPoolRemoval();
error NoTokensAvailableToRemoveFromPool();
error NonPositiveQuantity();
error NoPuppersRemaining();
error InvalidTokenAddress();
error TokenNotConfiguredForLocking();
error Overflow();
error EmptyPuppers();
error NoLockFoundForPixel();
error PupperIDbelowIndexOffset();
error InvalidSHIBAWidth();
error TokenIDBelowIndexOffset();
error ArraysLengthMismatch();
error EmptyArrays();
error BatchTooLarge();
error InvalidRecipient();
error InvalidTokenID();
error TokenIDOutOfRange();
error TokenAlreadyExists();
error TokenAlreadyReserved();
error TotalReservedOverflow();
error TokenNotReserved();
error NotReservedForYou();
error BurnNotConfirmed();
error TokenAlreadyClaimed();
error NoReservationsToClear();
error DOG20NotSet();
error DOG20NotConfiguredForLocking();
error NoAvailableTokensToMint();
error MintingNotStarted();
error MintingAlreadyStarted();

/// @title PXV3 — Pixel Portal V3
/// @notice ERC-721 pixel NFT contract where each token represents a pixel on a Shiba Inu grid image.
/// Pixels are minted by locking ERC-20 collateral (e.g. $DOG) and burned to reclaim it.
/// Supports a two-phase launch: an admin-only reservation phase for V1/V2 migration, followed by
/// public minting once `startMinting` is called. Reserved tokens require off-chain burn confirmation
/// (set via `setBurnFlags`) before they can be claimed.
/// @dev UUPS-upgradeable proxy pattern. Storage layout must remain compatible across upgrades — see `__gap`.
/// @dev THIS SHOULD BE AN INITIAL DEPLOY, NOT AN UPGRADE!
contract PXV3 is
    Initializable,
    ERC721CustomUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    bytes32 public constant BURN_FLAG_MANAGER_ROLE = keccak256("BURN_FLAG_MANAGER_ROLE");
    uint256 public constant MAX_BATCH_SIZE = 50;

    // Fractional.art ERC20 contract holding $DOG tokens
    /// @dev Informational only, the contract doesn't use this directly.
    IERC20 public DOG20;

    uint256 public puppersRemaining;

    uint256 public totalSupply;

    mapping(uint256 => uint256) indexToPupper;
    mapping(uint256 => uint256) pupperToIndex;

    // Configurable token lock system
    struct TokenLock {
        address token;
        uint256 amount;
    }

    mapping(address => uint256) public tokenLockAmounts;
    mapping(uint256 => TokenLock) public pixelLocks;
    uint256 public constant INDEX_OFFSET = 1000000;
    uint256 public constant MAGIC_NULL = 0;

    uint256 public SHIBA_WIDTH;
    uint256 public SHIBA_HEIGHT;
    string public BASE_URI;

    // Reserved for future use, dev cut at deploy is 0
    address DOG20_FEES_ADDRESS_DEV;

    struct Reservation {
        address reservedFor;
        bool burnConfirmed;
    }

    mapping(uint256 => Reservation) public reservations;
    uint256 public totalReserved;

    /// @notice Once true, minting is enabled and reservations are disabled. Cannot be set back to false.
    bool public mintingStarted;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the PXV3 contract with ERC721, access control, and pixel grid parameters.
    /// @param name_ The ERC721 token name.
    /// @param symbol_ The ERC721 token symbol.
    /// @param DOG20Address The address of the DOG ERC20 token contract.
    /// @param ipfsUri_ The base URI for token metadata.
    /// @param width_ The pixel grid width.
    /// @param height_ The pixel grid height.
    /// @param DOG20_FEES_ADDRESS_DEV_ The address that receives dev fees from DOG20.
    /// @param owner_ The address granted admin and burn flag manager roles.
    function __PX_init(
        string memory name_,
        string memory symbol_,
        address DOG20Address,
        string memory ipfsUri_,
        uint256 width_,
        uint256 height_,
        address DOG20_FEES_ADDRESS_DEV_,
        address owner_
    ) public initializer {
        __ERC721Custom_init(name_, symbol_);
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(BURN_FLAG_MANAGER_ROLE, owner_);
        _pause();
        require(DOG20Address != address(0));
        DOG20 = IERC20(DOG20Address);

        // https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#avoid-initial-values-in-field-declarations
        SHIBA_WIDTH = width_;
        SHIBA_HEIGHT = height_;

        totalSupply = SHIBA_WIDTH * SHIBA_HEIGHT;
        puppersRemaining = SHIBA_WIDTH * SHIBA_HEIGHT;

        BASE_URI = ipfsUri_;

        DOG20_FEES_ADDRESS_DEV = DOG20_FEES_ADDRESS_DEV_;
    }

    /// @dev Mints a token and decrements the remaining supply counter.
    /// @param to The recipient address.
    /// @param tokenId The token ID to mint.
    function _mint(address to, uint256 tokenId) internal virtual override {
        if (puppersRemaining == 0) revert NoPuppersRemainingToMint();
        super._mint(to, tokenId);
        puppersRemaining -= 1;
    }

    /// @dev Burns a token and returns it to the available minting pool by swapping it with the last index.
    /// @param pupper The token ID to burn.
    function _burn(uint256 pupper) internal virtual override {
        if (pupper == MAGIC_NULL) revert PupperIsMagic();
        if (ERC721CustomUpgradeable.ownerOf(pupper) != _msgSender()) revert PupperIsNotYours();

        if (puppersRemaining >= totalSupply) revert CannotExceedTotalSupply();

        uint256 oldIndex = pupperToIndex[pupper];
        uint256 LAST_INDEX = INDEX_OFFSET + puppersRemaining;
        uint256 tmpPupper = indexToPupper[LAST_INDEX];
        pupperToIndex[pupper] = LAST_INDEX;
        pupperToIndex[tmpPupper] = oldIndex;
        indexToPupper[oldIndex] = tmpPupper;
        indexToPupper[LAST_INDEX] = pupper;
        puppersRemaining += 1;

        super._burn(pupper);
    }

    /// @dev Mints a specific token for migration without using the random selection pool.
    /// @param to The recipient address.
    /// @param tokenId The token ID to mint.
    function _mintForMigration(address to, uint256 tokenId) internal {
        super._mint(to, tokenId);
        if (puppersRemaining == 0) revert NoPuppersRemainingForMigration();
        puppersRemaining -= 1;
    }

    /// @dev Enforces pause on all token movements (transfers, mints, and burns).
    function _beforeTokenTransfer(address from, address to, uint256 tokenId) internal virtual override {
        super._beforeTokenTransfer(from, to, tokenId);
        _requireNotPaused();
    }

    /// @dev Removes a specific token from the available minting pool by swapping it to the end.
    /// @param tokenId The token ID to remove from the pool.
    function _removeTokenFromAvailablePool(uint256 tokenId) internal {
        // O(1) lookup using pupperToIndex
        // If pupperToIndex[tokenId] == 0, token was never moved and is at its natural index
        uint256 tokenIndex = pupperToIndex[tokenId];
        if (tokenIndex == 0) {
            tokenIndex = tokenId; // Natural position
        }

        // Verify token is actually at this index
        uint256 tokenAtIndex = indexToPupper[tokenIndex];
        if (tokenAtIndex == MAGIC_NULL) {
            tokenAtIndex = tokenIndex; // Natural position (uninitialized means index == tokenId)
        }

        if (tokenAtIndex != tokenId) {
            revert TokenNotAvailableForMinting();
        }

        if (indexToPupper[tokenIndex] == MAGIC_NULL) {
            indexToPupper[tokenIndex] = tokenIndex;
        }

        if (puppersRemaining == 0) revert NoPuppersRemainingForPoolRemoval();
        uint256 LAST_INDEX = INDEX_OFFSET + puppersRemaining - 1;
        if (indexToPupper[LAST_INDEX] == MAGIC_NULL) {
            indexToPupper[LAST_INDEX] = LAST_INDEX;
        }

        uint256 lastAvailableToken = indexToPupper[LAST_INDEX];
        indexToPupper[tokenIndex] = lastAvailableToken;
        pupperToIndex[lastAvailableToken] = tokenIndex;

        pupperToIndex[tokenId] = LAST_INDEX;
        indexToPupper[LAST_INDEX] = tokenId;

        puppersRemaining -= 1;
    }

    /// @notice Returns a pseudo-random uint256 derived from block and sender data.
    /// @return A pseudo-random value.
    function randYish() public view returns (uint256) {
        return uint256(
            keccak256(
                abi.encodePacked(
                    block.timestamp,
                    block.prevrandao,
                    uint256(keccak256(abi.encodePacked(block.coinbase))) / block.timestamp,
                    block.gaslimit,
                    uint256(keccak256(abi.encodePacked(_msgSender()))) / block.timestamp,
                    block.number,
                    puppersRemaining
                )
            )
        );
    }

    /// @dev Returns a pseudo-random value in the range [0, maxRand).
    /// @param maxRand The exclusive upper bound.
    /// @return A pseudo-random value within the range.
    function randYishInRange(uint256 maxRand) internal view returns (uint256) {
        return randYish() % maxRand;
    }

    /// @notice Mints a batch of randomly selected pixels by locking ERC20 tokens as collateral.
    /// @param qty The number of pixels to mint (max MAX_BATCH_SIZE).
    /// @param tokenAddress The ERC20 token address to lock as collateral.
    function mintPuppers(uint256 qty, address tokenAddress) public whenNotPaused nonReentrant {
        if (!mintingStarted) revert MintingNotStarted();
        if (qty == 0) revert NonPositiveQuantity();
        if (qty > MAX_BATCH_SIZE) revert BatchTooLarge();
        if (qty > puppersRemaining) revert NoPuppersRemaining();
        if (tokenAddress == address(0)) revert InvalidTokenAddress();

        uint256 lockAmount = tokenLockAmounts[tokenAddress];
        if (lockAmount == 0) revert TokenNotConfiguredForLocking();

        // We don't need to test for overflow because that's checked when the amount was set on the token.
        uint256 totalTokenAmount = qty * lockAmount;

        for (uint256 i = 0; i < qty;) {
            uint256 pupper = _selectAvailableToken();
            _mint(_msgSender(), pupper);

            pixelLocks[pupper] = TokenLock({token: tokenAddress, amount: lockAmount});

            emit TokenLocked(pupper, tokenAddress, lockAmount);

            unchecked {
                ++i;
            }
        }

        SafeERC20.safeTransferFrom(IERC20(tokenAddress), _msgSender(), address(this), totalTokenAmount);
    }

    /// @dev Selects a random available (non-reserved) token from the minting pool. Falls back to linear scan if random selection repeatedly hits reserved tokens.
    /// @return The selected token ID.
    function _selectAvailableToken() internal returns (uint256) {
        uint256 attempts = 0;
        uint256 maxAttempts = puppersRemaining * 2;

        while (attempts < maxAttempts) {
            if (puppersRemaining == 0) revert NoPuppersRemaining();
            uint256 index = INDEX_OFFSET + randYishInRange(puppersRemaining);

            if (indexToPupper[index] == MAGIC_NULL) {
                indexToPupper[index] = index;
            }
            uint256 LAST_INDEX = INDEX_OFFSET + puppersRemaining - 1;
            if (indexToPupper[LAST_INDEX] == MAGIC_NULL) {
                indexToPupper[LAST_INDEX] = LAST_INDEX;
            }

            uint256 pupper = indexToPupper[index];

            if (isReserved(pupper)) {
                ++attempts;
                continue;
            }

            indexToPupper[index] = indexToPupper[LAST_INDEX];
            indexToPupper[LAST_INDEX] = pupper;
            pupperToIndex[pupper] = LAST_INDEX;

            return pupper;
        }

        return _findFirstAvailableToken();
    }

    /// @dev Linear scan fallback to find the first available (non-reserved) token in the pool.
    /// @return The first available token ID.
    function _findFirstAvailableToken() internal returns (uint256) {
        uint256 searchEnd = INDEX_OFFSET + puppersRemaining;
        for (uint256 i = INDEX_OFFSET; i < searchEnd;) {
            uint256 pupper = indexToPupper[i] == MAGIC_NULL ? i : indexToPupper[i];

            if (!isReserved(pupper)) {
                if (puppersRemaining == 0) revert NoPuppersRemaining();
                uint256 LAST_INDEX = INDEX_OFFSET + puppersRemaining - 1;
                if (indexToPupper[LAST_INDEX] == MAGIC_NULL) {
                    indexToPupper[LAST_INDEX] = LAST_INDEX;
                }

                indexToPupper[i] = indexToPupper[LAST_INDEX];
                indexToPupper[LAST_INDEX] = pupper;
                pupperToIndex[pupper] = LAST_INDEX;

                return pupper;
            }

            unchecked {
                ++i;
            }
        }

        revert NoAvailableTokensToMint();
    }

    /// @notice Burns a batch of pixels and returns the locked ERC20 collateral to the caller.
    /// @param puppers The array of token IDs to burn (max MAX_BATCH_SIZE).
    function burnPuppers(uint256[] memory puppers) public virtual whenNotPaused nonReentrant {
        if (puppers.length == 0) revert EmptyPuppers();
        if (puppers.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        address[] memory uniqueTokens = new address[](puppers.length);
        uint256[] memory tokenAmounts = new uint256[](puppers.length);
        uint256 uniqueTokenCount = 0;

        for (uint256 i = 0; i < puppers.length;) {
            uint256 pupper = puppers[i];
            TokenLock memory lock = pixelLocks[pupper];

            if (lock.token == address(0)) revert NoLockFoundForPixel();

            _burn(pupper);

            uint256 tokenIndex = uniqueTokenCount;
            address lockToken = lock.token;
            for (uint256 j = 0; j < uniqueTokenCount;) {
                if (uniqueTokens[j] == lockToken) {
                    tokenIndex = j;
                    break;
                }
                unchecked {
                    ++j;
                }
            }

            if (tokenIndex == uniqueTokenCount) {
                uniqueTokens[uniqueTokenCount] = lockToken;
                tokenAmounts[uniqueTokenCount] = 0;
                uniqueTokenCount++;
            }

            tokenAmounts[tokenIndex] += lock.amount;

            delete pixelLocks[pupper];

            emit TokenUnlocked(pupper, lock.token, lock.amount);

            unchecked {
                ++i;
            }
        }

        for (uint256 i = 0; i < uniqueTokenCount;) {
            processCollateralAfterBurn(uniqueTokens[i], tokenAmounts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Transfers locked collateral back to the burner after pixel burn.
    /// @param tokenAddress The ERC20 token address to transfer.
    /// @param totalAmount The total amount to transfer.
    function processCollateralAfterBurn(address tokenAddress, uint256 totalAmount) internal {
        // Return 100% of locked tokens to the burner (no dev fee in V2)
        SafeERC20.safeTransfer(IERC20(tokenAddress), _msgSender(), totalAmount);
    }

    /// @notice Converts a pupper token ID to its zero-based pixel index.
    /// @param pupper The token ID.
    /// @return The pixel index (tokenId - INDEX_OFFSET).
    function pupperToPixel(uint256 pupper) public pure returns (uint256) {
        if (pupper < INDEX_OFFSET) revert PupperIDbelowIndexOffset();
        return pupper - INDEX_OFFSET;
    }

    /// @notice Converts a pupper token ID to its (x, y) pixel coordinates on the grid.
    /// @param pupper The token ID.
    /// @return A two-element array [x, y].
    function pupperToPixelCoords(uint256 pupper) public view returns (uint256[2] memory) {
        if (pupper < INDEX_OFFSET) revert PupperIDbelowIndexOffset();
        uint256 index = pupper - INDEX_OFFSET;
        if (SHIBA_WIDTH == 0) revert InvalidSHIBAWidth();
        return [index % SHIBA_WIDTH, index / SHIBA_WIDTH];
    }

    /// @dev Returns the base URI used for token metadata.
    /// @return The base URI string.
    function _baseURI() internal view virtual override returns (string memory) {
        return BASE_URI;
    }

    /// @notice Returns the metadata URI for a given token, using sharded IPFS paths.
    /// @param tokenId The token ID to query.
    /// @return The full metadata URI string.
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        if (!_exists(tokenId)) revert ERC721MetadataURIQueryForNonexistentToken();

        string memory baseURI = _baseURI();
        if (tokenId < INDEX_OFFSET) revert TokenIDBelowIndexOffset();
        uint256 pixelIndex = tokenId - INDEX_OFFSET;
        uint256 shard = 1 + pixelIndex / 5000;
        return bytes(baseURI).length > 0
            ? string(
                abi.encodePacked(
                    baseURI,
                    "metadata-sh",
                    Strings.toString(shard),
                    "/",
                    "metadata-",
                    Strings.toString(tokenId),
                    ".json"
                )
            )
            : "";
    }

    /// @notice Reserves specific token IDs for V1/V2 holders to claim after burn confirmation. Only callable while paused and before minting starts.
    /// @param tokenIds The token IDs to reserve.
    /// @param recipients The addresses each token is reserved for (must match tokenIds length).
    function reserveTokensForMigration(uint256[] calldata tokenIds, address[] calldata recipients)
        external
        whenPaused
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (mintingStarted) revert MintingAlreadyStarted();
        if (tokenIds.length != recipients.length) revert ArraysLengthMismatch();
        if (tokenIds.length == 0) revert EmptyArrays();
        if (tokenIds.length > 100) revert BatchTooLarge();

        for (uint256 i = 0; i < tokenIds.length;) {
            uint256 tokenId = tokenIds[i];
            address recipient = recipients[i];

            if (recipient == address(0)) revert InvalidRecipient();
            if (tokenId < INDEX_OFFSET) revert InvalidTokenID();
            if (tokenId >= INDEX_OFFSET + totalSupply) revert TokenIDOutOfRange();
            if (_exists(tokenId)) revert TokenAlreadyExists();
            if (isReserved(tokenId)) revert TokenAlreadyReserved();

            _removeTokenFromAvailablePool(tokenId);

            reservations[tokenId] = Reservation({reservedFor: recipient, burnConfirmed: false});
            totalReserved += 1;

            emit TokenReserved(tokenId, recipient);

            unchecked {
                ++i;
            }
        }
    }

    /// @dev Looks up a token's index in the available minting pool using O(1) mapping lookup.
    /// @param tokenId The token ID to find.
    /// @return The pool index of the token, or 0 if not found.
    function _findTokenInAvailablePool(uint256 tokenId) internal view returns (uint256) {
        // O(1) lookup using pupperToIndex
        // If pupperToIndex[tokenId] == 0, token was never moved and is at its natural index
        uint256 tokenIndex = pupperToIndex[tokenId];
        if (tokenIndex == 0) {
            tokenIndex = tokenId; // Natural position
        }

        // Verify token is actually at this index
        uint256 tokenAtIndex = indexToPupper[tokenIndex];
        if (tokenAtIndex == MAGIC_NULL) {
            tokenAtIndex = tokenIndex; // Natural position (uninitialized means index == tokenId)
        }

        if (tokenAtIndex != tokenId) {
            return 0; // Token not found
        }

        return tokenIndex;
    }

    /// @notice Sets burn confirmation flags for reserved tokens. Only callable by the burn flag manager role.
    /// @param tokenIds The reserved token IDs to update (max 200).
    /// @param burnStatuses The burn confirmation status for each token.
    function setBurnFlags(uint256[] calldata tokenIds, bool[] calldata burnStatuses)
        external
        onlyRole(BURN_FLAG_MANAGER_ROLE)
    {
        require(tokenIds.length == burnStatuses.length, "Arrays length mismatch");
        if (tokenIds.length == 0) revert EmptyArrays();
        if (tokenIds.length > 200) revert BatchTooLarge();

        for (uint256 i = 0; i < tokenIds.length;) {
            uint256 tokenId = tokenIds[i];
            bool burnStatus = burnStatuses[i];

            if (!isReserved(tokenId)) revert TokenNotReserved();

            reservations[tokenId].burnConfirmed = burnStatus;
            emit BurnFlagSet(tokenId, burnStatus);

            unchecked {
                ++i;
            }
        }
    }

    /// @dev Claims a reserved token by minting it to the caller and locking their ERC20 collateral. Requires the token's burn flag to be confirmed.
    /// @param tokenId The reserved token ID to claim.
    /// @param tokenAddress The ERC20 token address to lock as collateral.
    function _claimReservedToken(uint256 tokenId, address tokenAddress) internal {
        if (tokenId < INDEX_OFFSET) revert InvalidTokenID();
        if (tokenId >= INDEX_OFFSET + totalSupply) revert TokenIDOutOfRange();
        if (!isReserved(tokenId)) revert TokenNotReserved();
        if (tokenAddress == address(0)) revert InvalidTokenAddress();

        uint256 lockAmount = tokenLockAmounts[tokenAddress];
        if (lockAmount == 0) revert TokenNotConfiguredForLocking();

        Reservation memory reservation = reservations[tokenId];
        if (reservation.reservedFor != _msgSender()) revert NotReservedForYou();
        if (!reservation.burnConfirmed) revert BurnNotConfirmed();
        if (_exists(tokenId)) revert TokenAlreadyClaimed();

        delete reservations[tokenId];
        if (totalReserved == 0) revert NoReservationsToClear();
        totalReserved -= 1;

        pixelLocks[tokenId] = TokenLock({token: tokenAddress, amount: lockAmount});

        super._mint(_msgSender(), tokenId);

        SafeERC20.safeTransferFrom(IERC20(tokenAddress), _msgSender(), address(this), lockAmount);

        emit TokenLocked(tokenId, tokenAddress, lockAmount);
        emit ReservedTokenClaimed(tokenId, _msgSender());
    }

    /// @notice Claims a single reserved token by locking ERC20 collateral. The token's burn flag must be confirmed.
    /// @param tokenId The reserved token ID to claim.
    /// @param tokenAddress The ERC20 token address to lock as collateral.
    function claimReservedToken(uint256 tokenId, address tokenAddress) external whenNotPaused nonReentrant {
        _claimReservedToken(tokenId, tokenAddress);
    }

    /// @notice Claims multiple reserved tokens in a single transaction (max MAX_BATCH_SIZE).
    /// @param tokenIds The reserved token IDs to claim.
    /// @param tokenAddress The ERC20 token address to lock as collateral for all tokens.
    function claimReservedTokensBatch(uint256[] calldata tokenIds, address tokenAddress)
        external
        whenNotPaused
        nonReentrant
    {
        uint256 length = tokenIds.length;
        if (length == 0) revert EmptyArrays();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge();

        for (uint256 i = 0; i < length;) {
            _claimReservedToken(tokenIds[i], tokenAddress);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Returns the reservation details for a token. Reverts if the token is not reserved.
    /// @param tokenId The token ID to query.
    /// @return reservedFor The address the token is reserved for.
    /// @return burnConfirmed Whether the burn has been confirmed for this token.
    function getReservation(uint256 tokenId) external view returns (address reservedFor, bool burnConfirmed) {
        if (tokenId < INDEX_OFFSET) revert InvalidTokenID();
        if (tokenId >= INDEX_OFFSET + totalSupply) revert TokenIDOutOfRange();
        if (!isReserved(tokenId)) revert TokenNotReserved();
        Reservation memory reservation = reservations[tokenId];
        return (reservation.reservedFor, reservation.burnConfirmed);
    }

    /// @notice Returns the number of pixels still available for minting.
    /// @return The remaining supply.
    function getAvailableSupply() external view returns (uint256) {
        return puppersRemaining;
    }

    /// @notice Checks whether a user can claim a specific reserved token (reserved for them, burn confirmed, not yet minted).
    /// @param tokenId The token ID to check.
    /// @param user The address to check eligibility for.
    /// @return True if the user can claim the token.
    function canClaimReservedToken(uint256 tokenId, address user) external view returns (bool) {
        if (user == address(0)) return false;
        if (tokenId < INDEX_OFFSET) return false;
        if (tokenId >= INDEX_OFFSET + totalSupply) return false;
        if (!isReserved(tokenId)) return false;
        if (_exists(tokenId)) return false;

        Reservation memory reservation = reservations[tokenId];
        return reservation.reservedFor == user && reservation.burnConfirmed;
    }

    /// @notice Returns all tokens from the provided list that are reserved for the given user, along with their burn confirmation status.
    /// @param user The address to filter reservations for.
    /// @param tokenIdsToCheck The token IDs to check.
    /// @return tokenIds The subset of token IDs reserved for the user.
    /// @return burnConfirmed The burn confirmation status for each returned token.
    function getReservedTokensForUser(address user, uint256[] calldata tokenIdsToCheck)
        external
        view
        returns (uint256[] memory tokenIds, bool[] memory burnConfirmed)
    {
        if (user == address(0)) revert InvalidRecipient();

        // First pass: count matching reservations
        uint256 count = 0;
        for (uint256 i = 0; i < tokenIdsToCheck.length;) {
            if (isReserved(tokenIdsToCheck[i]) && reservations[tokenIdsToCheck[i]].reservedFor == user) {
                ++count;
            }
            unchecked {
                ++i;
            }
        }

        // Allocate exact size arrays
        tokenIds = new uint256[](count);
        burnConfirmed = new bool[](count);

        // Second pass: populate arrays
        uint256 index = 0;
        for (uint256 i = 0; i < tokenIdsToCheck.length && index < count;) {
            uint256 tokenId = tokenIdsToCheck[i];
            if (isReserved(tokenId) && reservations[tokenId].reservedFor == user) {
                tokenIds[index] = tokenId;
                burnConfirmed[index] = reservations[tokenId].burnConfirmed;
                index++;
            }
            unchecked {
                ++i;
            }
        }
    }

    event TokenReserved(uint256 indexed tokenId, address indexed reservedFor);
    event BurnFlagSet(uint256 indexed tokenId, bool burnConfirmed);
    event ReservedTokenClaimed(uint256 indexed tokenId, address indexed claimer);

    event TokenLockAmountSet(address indexed tokenAddress, uint256 amount);
    event TokenLocked(uint256 indexed pixelId, address indexed tokenAddress, uint256 amount);
    event TokenUnlocked(uint256 indexed pixelId, address indexed tokenAddress, uint256 amount);

    event MigrationBatchMinted(uint256[] tokenIds, address[] recipients, uint256 batchSize);
    event MintingStarted();

    /// @notice Pauses all minting and burning operations. Only callable by admin.
    function pause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Unpauses the contract, re-enabling minting and burning. Only callable by admin.
    function unpause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Enables minting and permanently disables new reservations.
     * @dev This is a one-way switch. Once called, reserveTokensForMigration will revert.
     *      Call this after all V1 token reservations have been made.
     */
    function startMinting() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (mintingStarted) revert MintingAlreadyStarted();
        mintingStarted = true;
        emit MintingStarted();
    }

    /// @notice Configures the amount of ERC20 tokens required to lock per pixel for a given token address.
    /// @param tokenAddress The ERC20 token address to configure.
    /// @param amount The lock amount per pixel. Set to 0 to disable this token.
    function setTokenLockAmount(address tokenAddress, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        if (amount != 0 && amount > type(uint256).max / MAX_BATCH_SIZE) revert Overflow();
        tokenLockAmounts[tokenAddress] = amount;
        emit TokenLockAmountSet(tokenAddress, amount);
    }

    /// @notice Updates the base URI used for token metadata. Only callable by admin.
    /// @param newBaseUri The new base URI string.
    function setBaseUri(string memory newBaseUri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        BASE_URI = newBaseUri;
        emit BaseUriSet(newBaseUri);
    }

    event BaseUriSet(string newBaseUri);

    /// @dev Authorizes a UUPS upgrade. Restricted to admin role.
    /// @param newImplementation The address of the new implementation contract.
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @dev See {IERC165-supportsInterface}. Resolves the diamond inheritance between ERC721 and AccessControl.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721CustomUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Checks whether a token ID has an active reservation.
    /// @param tokenId The token ID to check.
    /// @return True if the token is reserved.
    function isReserved(uint256 tokenId) public view returns (bool) {
        return reservations[tokenId].reservedFor != address(0);
    }

    /// @notice Returns the current upgrade version of the contract implementation.
    /// @return The version number.
    function upgradeVersion() public pure returns (uint256) {
        // UPDATE THIS ON EVERY UPGRADE VERSION
        return 1;
    }

    /// @dev Reserved storage slots for future upgrades. This gap ensures that adding new state
    /// variables in upgraded implementations does not shift the storage layout of child contracts.
    /// When adding new state variables, decrease the gap size by the number of slots consumed
    /// so that the total storage footprint of the contract remains constant.
    /// For example, adding one uint256 variable means changing this to uint256[42].
    uint256[43] private __gap;
}
