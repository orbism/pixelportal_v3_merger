// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PXV3} from "../src/PXV3.sol";
import {MockDOG20} from "./mocks/MockDOG20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

/**
 * @title PXRandomnessTest
 * @dev Tests to verify the randomness formula produces expected token IDs.
 *      If the formula changes, this test will fail and need updating.
 */
contract PXRandomnessTest is Test {
    uint256 constant INDEX_OFFSET = 1000000;
    uint256 constant MOCK_WIDTH = 680;
    uint256 constant MOCK_HEIGHT = 480;
    uint256 constant MOCK_SUPPLY = MOCK_WIDTH * MOCK_HEIGHT;
    string constant MOCK_URI = "ipfs://dog-repo/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 1000 * 10 ** 18;

    PXV3 public px;
    MockDOG20 public dog20;
    address public owner;
    address public minter;
    address public feesAccountDev;

    function setUp() public {
        owner = address(this);
        minter = makeAddr("minter");
        feesAccountDev = makeAddr("feesAccountDev");

        address[] memory mockAddresses = new address[](2);
        mockAddresses[0] = owner;
        mockAddresses[1] = minter;

        dog20 = new MockDOG20();
        dog20.initialize(mockAddresses, DOG_TO_PIXEL_SATOSHIS * 100);

        PXV3 implementation = new PXV3();

        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            "LONG LIVE D O G",
            "PX",
            address(dog20),
            MOCK_URI,
            MOCK_WIDTH,
            MOCK_HEIGHT,
            feesAccountDev,
            address(this)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        px = PXV3(address(proxy));

        px.unpause();
        px.startMinting();
        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);
    }

    /**
     * @dev Tests that the first 10 minted token IDs match expected values.
     *      Uses fixed block parameters to ensure deterministic results.
     *      Token IDs include INDEX_OFFSET (1000000).
     */
    function test_FirstTenTokenIds() public {
        // Set deterministic block parameters
        vm.warp(1700000000); // Fixed timestamp
        vm.roll(1000000); // Fixed block number
        vm.prevrandao(bytes32(uint256(12345))); // Fixed prevrandao
        vm.coinbase(address(0x1234567890123456789012345678901234567890));

        // Approve tokens for minting
        vm.prank(minter);
        dog20.approve(address(px), DOG_TO_PIXEL_SATOSHIS * 10);

        // Mint 10 tokens one at a time to capture each token ID
        uint256[] memory tokenIds = new uint256[](10);

        for (uint256 i = 0; i < 10; i++) {
            vm.prank(minter);
            vm.recordLogs();
            px.mintPuppers(1, address(dog20));

            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 j = 0; j < logs.length; j++) {
                if (
                    logs[j].topics.length == 4 && logs[j].topics[0] == keccak256("Transfer(address,address,uint256)")
                        && logs[j].topics[1] == bytes32(0) // from address(0) = mint
                ) {
                    tokenIds[i] = uint256(logs[j].topics[3]);
                    break;
                }
            }
        }

        // Log the token IDs for reference
        console.log("First 10 token IDs (with INDEX_OFFSET of 1000000):");
        for (uint256 i = 0; i < 10; i++) {
            console.log("Token ID:", tokenIds[i]);
        }

        // Expected token IDs - update these if the randomness formula changes
        // These values are derived from the current randYish() implementation
        // with the fixed block parameters above
        uint256[10] memory expectedTokenIds = [
            uint256(1099356),
            uint256(1134066),
            uint256(1068167),
            uint256(1055579),
            uint256(1003228),
            uint256(1007954),
            uint256(1199893),
            uint256(1189893),
            uint256(1306055),
            uint256(1172491)
        ];

        for (uint256 i = 0; i < 10; i++) {
            assertEq(
                tokenIds[i], expectedTokenIds[i], string(abi.encodePacked("Token ", vm.toString(i + 1), " ID mismatch"))
            );
            // Verify all token IDs are >= INDEX_OFFSET
            assertGe(tokenIds[i], INDEX_OFFSET, "Token ID should be >= INDEX_OFFSET");
            // Verify all token IDs are < INDEX_OFFSET + MOCK_SUPPLY
            assertLt(tokenIds[i], INDEX_OFFSET + MOCK_SUPPLY, "Token ID should be < INDEX_OFFSET + MOCK_SUPPLY");
        }
    }
}

/**
 * @title PXReservationSkipTest
 * @dev Tests that minting correctly skips reserved tokens.
 *      This verifies the protection in _selectAvailableToken() works correctly.
 */
contract PXReservationSkipTest is Test {
    uint256 constant INDEX_OFFSET = 1000000;
    uint256 constant MOCK_WIDTH = 680;
    uint256 constant MOCK_HEIGHT = 480;
    string constant MOCK_URI = "ipfs://dog-repo/";
    uint256 constant DOG_TO_PIXEL_SATOSHIS = 1000 * 10 ** 18;

    PXV3 public px;
    ERC20Mock public dog20;
    address public owner;
    address public minter;
    address public reservedUser;
    address public feesAccountDev;

    function setUp() public {
        owner = address(this);
        minter = makeAddr("minter");
        reservedUser = makeAddr("reservedUser");
        feesAccountDev = makeAddr("feesAccountDev");

        dog20 = new ERC20Mock();

        PXV3 implementation = new PXV3();

        bytes memory initData = abi.encodeWithSelector(
            PXV3.__PX_init.selector,
            "LONG LIVE D O G",
            "PX",
            address(dog20),
            MOCK_URI,
            MOCK_WIDTH,
            MOCK_HEIGHT,
            feesAccountDev,
            address(this)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        px = PXV3(address(proxy));

        // Contract starts paused - configure lock amount while paused
        px.setTokenLockAmount(address(dog20), DOG_TO_PIXEL_SATOSHIS);

        // Mint tokens to minter and approve
        dog20.mint(minter, DOG_TO_PIXEL_SATOSHIS * 100);
        vm.prank(minter);
        dog20.approve(address(px), type(uint256).max);

        // Mint tokens to reserved user for claiming later
        dog20.mint(reservedUser, DOG_TO_PIXEL_SATOSHIS * 100);
        vm.prank(reservedUser);
        dog20.approve(address(px), type(uint256).max);
    }

    /**
     * @dev Helper to get the token ID from a mint transaction's logs
     */
    function getMintedTokenId(Vm.Log[] memory logs) internal pure returns (uint256) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].topics.length == 4 && logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")
                    && logs[i].topics[1] == bytes32(0) // from address(0) = mint
            ) {
                return uint256(logs[i].topics[3]);
            }
        }
        revert("No mint Transfer event found");
    }

    /**
     * @dev Tests that when a token that would be randomly selected is reserved,
     *      the minting function skips it and selects a different token.
     *
     *      Strategy:
     *      1. Set fixed block parameters
     *      2. Read what randYish() would return (predicting the first token)
     *      3. Reserve that exact token
     *      4. Unpause and mint
     *      5. Verify the minted token is NOT the reserved one
     */
    function test_MintSkipsReservedToken() public {
        // Step 1: Set deterministic block parameters
        vm.warp(1700000000);
        vm.roll(1000000);
        vm.prevrandao(bytes32(uint256(12345)));
        vm.coinbase(address(0x1234567890123456789012345678901234567890));

        // Step 2: Calculate what token would be selected first
        // Using the same formula as randYishInRange: randYish() % puppersRemaining
        uint256 puppersRemaining = px.puppersRemaining();
        uint256 predictedIndex = INDEX_OFFSET + (px.randYish() % puppersRemaining);
        // Since no tokens have been moved yet, indexToPupper[predictedIndex] == predictedIndex
        uint256 predictedTokenId = predictedIndex;

        console.log("Predicted first token ID:", predictedTokenId);
        console.log("Puppers remaining before reservation:", puppersRemaining);

        // Step 3: Reserve that exact token (contract is still paused from setUp)
        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = predictedTokenId;
        address[] memory recipients = new address[](1);
        recipients[0] = reservedUser;

        px.reserveTokensForMigration(tokenIds, recipients);

        assertTrue(px.isReserved(predictedTokenId), "Token should be reserved");
        console.log("Reserved token ID:", predictedTokenId);

        // Step 4: Unpause and mint
        px.unpause();
        px.startMinting();

        vm.prank(minter);
        vm.recordLogs();
        px.mintPuppers(1, address(dog20));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 mintedTokenId = getMintedTokenId(logs);

        console.log("Actually minted token ID:", mintedTokenId);

        // Step 5: Verify the minted token is NOT the reserved one
        assertNotEq(mintedTokenId, predictedTokenId, "Minted token should NOT be the reserved token");

        // The reserved token should still be reserved
        assertTrue(px.isReserved(predictedTokenId), "Reserved token should still be reserved");

        // The minted token should be owned by the minter
        assertEq(px.ownerOf(mintedTokenId), minter, "Minted token should be owned by minter");

        // The reserved token should NOT be minted (no owner)
        vm.expectRevert(); // ownerOf reverts for non-existent tokens
        px.ownerOf(predictedTokenId);
    }

    /**
     * @dev Tests that reserving multiple tokens that would be selected consecutively
     *      causes minting to skip all of them.
     */
    function test_MintSkipsMultipleReservedTokens() public {
        // Set deterministic block parameters
        vm.warp(1700000000);
        vm.roll(1000000);
        vm.prevrandao(bytes32(uint256(12345)));
        vm.coinbase(address(0x1234567890123456789012345678901234567890));

        // Get the first predicted token
        uint256 puppersRemaining = px.puppersRemaining();
        uint256 firstPredictedIndex = INDEX_OFFSET + (px.randYish() % puppersRemaining);

        // Reserve the first 5 tokens starting from the predicted one
        // This ensures that even if the random selection lands on any of these,
        // it will have to skip them all
        uint256[] memory tokenIds = new uint256[](5);
        address[] memory recipients = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            tokenIds[i] = firstPredictedIndex + i;
            recipients[i] = reservedUser;
        }

        px.reserveTokensForMigration(tokenIds, recipients);

        // Unpause and mint
        px.unpause();
        px.startMinting();

        vm.prank(minter);
        vm.recordLogs();
        px.mintPuppers(1, address(dog20));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 mintedTokenId = getMintedTokenId(logs);

        console.log("First predicted token:", firstPredictedIndex);
        console.log("Actually minted token:", mintedTokenId);

        // Verify the minted token is not any of the reserved ones
        for (uint256 i = 0; i < 5; i++) {
            assertNotEq(mintedTokenId, tokenIds[i], "Minted token should not be any reserved token");
            assertTrue(px.isReserved(tokenIds[i]), "Reserved token should still be reserved");
        }

        assertEq(px.ownerOf(mintedTokenId), minter);
    }

    /**
     * @dev Tests that reserved tokens can still be claimed by the reserved user
     *      after regular minting has occurred.
     */
    function test_ReservedTokenCanBeClaimedAfterOtherMints() public {
        // Set deterministic block parameters
        vm.warp(1700000000);
        vm.roll(1000000);
        vm.prevrandao(bytes32(uint256(12345)));
        vm.coinbase(address(0x1234567890123456789012345678901234567890));

        // Predict and reserve the first token
        uint256 puppersRemaining = px.puppersRemaining();
        uint256 predictedTokenId = INDEX_OFFSET + (px.randYish() % puppersRemaining);

        uint256[] memory tokenIds = new uint256[](1);
        tokenIds[0] = predictedTokenId;
        address[] memory recipients = new address[](1);
        recipients[0] = reservedUser;

        px.reserveTokensForMigration(tokenIds, recipients);

        // Set burn flag so it can be claimed
        bool[] memory burnStatuses = new bool[](1);
        burnStatuses[0] = true;
        px.setBurnFlags(tokenIds, burnStatuses);

        // Unpause
        px.unpause();
        px.startMinting();

        // Regular user mints several tokens (none should be the reserved one)
        vm.prank(minter);
        px.mintPuppers(10, address(dog20));

        // Reserved token should still be reserved
        assertTrue(px.isReserved(predictedTokenId));

        // Reserved user claims their token
        vm.prank(reservedUser);
        px.claimReservedToken(predictedTokenId, address(dog20));

        // Now the reserved user owns the token
        assertEq(px.ownerOf(predictedTokenId), reservedUser);
        assertFalse(px.isReserved(predictedTokenId));

        console.log("Reserved token successfully claimed after other mints");
    }
}
