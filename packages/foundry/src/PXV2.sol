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

// Custom errors for PX contract
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

contract PXV2 is
    Initializable,
    ERC721CustomUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // Fractional.art ERC20 contract holding $DOG tokens
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

    function __PX_init(string memory, string memory, address, string memory, uint256, uint256, address, address)
        public
        initializer
    {
        // Empty - storage already initialized from V1
    }

    function _mint(address to, uint256 tokenId) internal virtual override {
        if (puppersRemaining == 0) revert NoPuppersRemainingToMint();
        super._mint(to, tokenId);
        puppersRemaining -= 1;
    }

    function _burn(uint256 pupper) internal virtual override {
        if (pupper == MAGIC_NULL) revert PupperIsMagic();
        if (ERC721CustomUpgradeable.ownerOf(pupper) != _msgSender()) revert PupperIsNotYours();

        if (puppersRemaining >= totalSupply) revert CannotExceedTotalSupply();

        uint256 oldIndex = pupperToIndex[pupper];
        uint256 LAST_INDEX;
        if (puppersRemaining > type(uint256).max - INDEX_OFFSET) revert Overflow();
        LAST_INDEX = INDEX_OFFSET + puppersRemaining;
        uint256 tmpPupper = indexToPupper[LAST_INDEX];
        pupperToIndex[pupper] = LAST_INDEX;
        pupperToIndex[tmpPupper] = oldIndex;
        indexToPupper[oldIndex] = tmpPupper;
        indexToPupper[LAST_INDEX] = pupper;
        puppersRemaining += 1;

        super._burn(pupper);
    }

    function _mintForMigration(address to, uint256 tokenId) internal {
        super._mint(to, tokenId);
        if (puppersRemaining == 0) revert NoPuppersRemainingForMigration();
        puppersRemaining -= 1;
    }

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
        if (puppersRemaining > type(uint256).max - INDEX_OFFSET) revert Overflow();
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

    function randYish() public view returns (uint256 ret) {
        uint256 seed = uint256(
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
        ret = seed;
    }

    function randYishInRange(uint256 maxRand) internal view returns (uint256 ret) {
        ret = randYish() % maxRand;
    }

    function mintPuppers(uint256 qty, address tokenAddress) public whenNotPaused nonReentrant {
        if (!mintingStarted) revert MintingNotStarted();
        if (qty == 0) revert NonPositiveQuantity();
        if (qty > 50) revert BatchTooLarge();
        if (qty > puppersRemaining) revert NoPuppersRemaining();
        if (tokenAddress == address(0)) revert InvalidTokenAddress();

        uint256 lockAmount = tokenLockAmounts[tokenAddress];
        if (lockAmount == 0) revert TokenNotConfiguredForLocking();
        if (qty != 0 && lockAmount > type(uint256).max / qty) revert Overflow();

        uint256 totalTokenAmount = qty * lockAmount;

        for (uint256 i = 0; i < qty; ++i) {
            uint256 pupper = _selectAvailableToken();
            _mint(_msgSender(), pupper);

            pixelLocks[pupper] = TokenLock({token: tokenAddress, amount: lockAmount});

            emit TokenLocked(pupper, tokenAddress, lockAmount);
        }

        SafeERC20.safeTransferFrom(IERC20(tokenAddress), _msgSender(), address(this), totalTokenAmount);
    }

    function _selectAvailableToken() internal returns (uint256) {
        uint256 attempts = 0;
        if (puppersRemaining > type(uint256).max / 2) revert Overflow();
        uint256 maxAttempts = puppersRemaining * 2;

        while (attempts < maxAttempts) {
            if (puppersRemaining == 0) revert NoPuppersRemaining();
            if (puppersRemaining > type(uint256).max - INDEX_OFFSET) revert Overflow();
            uint256 index = INDEX_OFFSET + randYishInRange(puppersRemaining);

            if (indexToPupper[index] == MAGIC_NULL) {
                indexToPupper[index] = index;
            }
            if (puppersRemaining == 0) revert NoPuppersRemaining();
            if (puppersRemaining > type(uint256).max - INDEX_OFFSET) revert Overflow();
            uint256 LAST_INDEX = INDEX_OFFSET + puppersRemaining - 1;
            if (indexToPupper[LAST_INDEX] == MAGIC_NULL) {
                indexToPupper[LAST_INDEX] = LAST_INDEX;
            }

            uint256 pupper = indexToPupper[index];

            if (isReserved(pupper)) {
                attempts++;
                continue;
            }

            indexToPupper[index] = indexToPupper[LAST_INDEX];
            indexToPupper[LAST_INDEX] = pupper;
            pupperToIndex[pupper] = LAST_INDEX;

            return pupper;
        }

        return _findFirstAvailableToken();
    }

    function _findFirstAvailableToken() internal returns (uint256) {
        if (puppersRemaining > type(uint256).max - INDEX_OFFSET) revert Overflow();
        uint256 searchEnd = INDEX_OFFSET + puppersRemaining;
        for (uint256 i = INDEX_OFFSET; i < searchEnd; ++i) {
            uint256 pupper = indexToPupper[i] == MAGIC_NULL ? i : indexToPupper[i];

            if (!isReserved(pupper)) {
                if (puppersRemaining == 0) revert NoPuppersRemaining();
                if (puppersRemaining > type(uint256).max - INDEX_OFFSET) revert Overflow();
                uint256 LAST_INDEX = INDEX_OFFSET + puppersRemaining - 1;
                if (indexToPupper[LAST_INDEX] == MAGIC_NULL) {
                    indexToPupper[LAST_INDEX] = LAST_INDEX;
                }

                indexToPupper[i] = indexToPupper[LAST_INDEX];
                indexToPupper[LAST_INDEX] = pupper;
                pupperToIndex[pupper] = LAST_INDEX;

                return pupper;
            }
        }

        revert NoAvailableTokensToMint();
    }

    function burnPuppers(uint256[] memory puppers) public virtual whenNotPaused nonReentrant {
        if (puppers.length == 0) revert EmptyPuppers();
        if (puppers.length > 50) revert BatchTooLarge();

        address[] memory uniqueTokens = new address[](puppers.length);
        uint256[] memory tokenAmounts = new uint256[](puppers.length);
        uint256 uniqueTokenCount = 0;

        for (uint256 i = 0; i < puppers.length; ++i) {
            uint256 pupper = puppers[i];
            TokenLock memory lock = pixelLocks[pupper];

            if (lock.token == address(0)) revert NoLockFoundForPixel();

            _burn(pupper);

            uint256 tokenIndex = uniqueTokenCount;
            address lockToken = lock.token;
            for (uint256 j = 0; j < uniqueTokenCount; ++j) {
                if (uniqueTokens[j] == lockToken) {
                    tokenIndex = j;
                    break;
                }
            }

            if (tokenIndex == uniqueTokenCount) {
                uniqueTokens[uniqueTokenCount] = lockToken;
                tokenAmounts[uniqueTokenCount] = 0;
                uniqueTokenCount++;
            }

            if (tokenAmounts[tokenIndex] > type(uint256).max - lock.amount) revert Overflow();
            tokenAmounts[tokenIndex] += lock.amount;

            delete pixelLocks[pupper];

            emit TokenUnlocked(pupper, lock.token, lock.amount);
        }

        for (uint256 i = 0; i < uniqueTokenCount; ++i) {
            processCollateralAfterBurn(uniqueTokens[i], tokenAmounts[i]);
        }
    }

    function processCollateralAfterBurn(address tokenAddress, uint256 totalAmount) internal {
        // Return 100% of locked tokens to the burner (no dev fee in V2)
        SafeERC20.safeTransfer(IERC20(tokenAddress), _msgSender(), totalAmount);
    }

    function pupperToPixel(uint256 pupper) public pure returns (uint256) {
        if (pupper < INDEX_OFFSET) revert PupperIDbelowIndexOffset();
        return pupper - INDEX_OFFSET;
    }

    function pupperToPixelCoords(uint256 pupper) public view returns (uint256[2] memory) {
        if (pupper < INDEX_OFFSET) revert PupperIDbelowIndexOffset();
        uint256 index = pupper - INDEX_OFFSET;
        if (SHIBA_WIDTH == 0) revert InvalidSHIBAWidth();
        return [index % SHIBA_WIDTH, index / SHIBA_WIDTH];
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return BASE_URI;
    }

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

        for (uint256 i = 0; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            address recipient = recipients[i];

            if (recipient == address(0)) revert InvalidRecipient();
            if (tokenId < INDEX_OFFSET) revert InvalidTokenID();
            if (tokenId >= INDEX_OFFSET + totalSupply) revert TokenIDOutOfRange();
            if (_exists(tokenId)) revert TokenAlreadyExists();
            if (isReserved(tokenId)) revert TokenAlreadyReserved();

            _removeTokenFromAvailablePool(tokenId);

            reservations[tokenId] = Reservation({reservedFor: recipient, burnConfirmed: false});
            if (totalReserved >= type(uint256).max) revert TotalReservedOverflow();
            totalReserved += 1;

            emit TokenReserved(tokenId, recipient);
        }
    }

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

    function setBurnFlags(uint256[] calldata tokenIds, bool[] calldata burnStatuses)
        external
        onlyRole(BURN_FLAG_MANAGER_ROLE)
    {
        require(tokenIds.length == burnStatuses.length, "Arrays length mismatch");
        if (tokenIds.length == 0) revert EmptyArrays();
        if (tokenIds.length > 200) revert BatchTooLarge();

        for (uint256 i = 0; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            bool burnStatus = burnStatuses[i];

            if (!isReserved(tokenId)) revert TokenNotReserved();

            reservations[tokenId].burnConfirmed = burnStatus;
            emit BurnFlagSet(tokenId, burnStatus);
        }
    }

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

    function claimReservedToken(uint256 tokenId, address tokenAddress) external whenNotPaused nonReentrant {
        _claimReservedToken(tokenId, tokenAddress);
    }

    function claimReservedTokensBatch(uint256[] calldata tokenIds, address tokenAddress)
        external
        whenNotPaused
        nonReentrant
    {
        uint256 length = tokenIds.length;
        if (length == 0) revert EmptyArrays();
        if (length > 50) revert BatchTooLarge();

        for (uint256 i = 0; i < length;) {
            _claimReservedToken(tokenIds[i], tokenAddress);
            unchecked {
                ++i;
            }
        }
    }

    function getReservation(uint256 tokenId) external view returns (address reservedFor, bool burnConfirmed) {
        if (tokenId < INDEX_OFFSET) revert InvalidTokenID();
        if (tokenId >= INDEX_OFFSET + totalSupply) revert TokenIDOutOfRange();
        if (!isReserved(tokenId)) revert TokenNotReserved();
        Reservation memory reservation = reservations[tokenId];
        return (reservation.reservedFor, reservation.burnConfirmed);
    }

    function getAvailableSupply() external view returns (uint256) {
        return puppersRemaining;
    }

    function canClaimReservedToken(uint256 tokenId, address user) external view returns (bool) {
        if (user == address(0)) return false;
        if (tokenId < INDEX_OFFSET) return false;
        if (tokenId >= INDEX_OFFSET + totalSupply) return false;
        if (!isReserved(tokenId)) return false;
        if (_exists(tokenId)) return false;

        Reservation memory reservation = reservations[tokenId];
        return reservation.reservedFor == user && reservation.burnConfirmed;
    }

    function getReservedTokensForUser(address user, uint256[] calldata tokenIdsToCheck)
        external
        view
        returns (uint256[] memory tokenIds, bool[] memory burnConfirmed)
    {
        if (user == address(0)) revert InvalidRecipient();

        // First pass: count matching reservations
        uint256 count = 0;
        for (uint256 i = 0; i < tokenIdsToCheck.length; ++i) {
            if (isReserved(tokenIdsToCheck[i]) && reservations[tokenIdsToCheck[i]].reservedFor == user) {
                count++;
            }
        }

        // Allocate exact size arrays
        tokenIds = new uint256[](count);
        burnConfirmed = new bool[](count);

        // Second pass: populate arrays
        uint256 index = 0;
        for (uint256 i = 0; i < tokenIdsToCheck.length && index < count; ++i) {
            uint256 tokenId = tokenIdsToCheck[i];
            if (isReserved(tokenId) && reservations[tokenId].reservedFor == user) {
                tokenIds[index] = tokenId;
                burnConfirmed[index] = reservations[tokenId].burnConfirmed;
                index++;
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

    function pause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

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

    function setTokenLockAmount(address tokenAddress, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        tokenLockAmounts[tokenAddress] = amount;
        emit TokenLockAmountSet(tokenAddress, amount);
    }

    function setBaseUri(string memory newBaseUri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        BASE_URI = newBaseUri;
        emit BaseUriSet(newBaseUri);
    }

    event BaseUriSet(string newBaseUri);

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721CustomUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    bytes32 public constant BURN_FLAG_MANAGER_ROLE = keccak256("BURN_FLAG_MANAGER_ROLE");

    function isReserved(uint256 tokenId) public view returns (bool) {
        return reservations[tokenId].reservedFor != address(0);
    }

    function upgradeVersion() public pure returns (uint256) {
        return 5;
    }

    uint256[43] private __gap;
}
