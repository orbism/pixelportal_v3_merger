import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, base } from 'viem/chains'
import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env from parent directory
dotenv.config({ path: resolve(import.meta.dirname, '../.env') })

const RPC_URL = process.env.RPC_URL
const PRIVATE_KEY = process.env.PRIVATE_KEY
const PROXY_ADDRESS = process.env.PROXY_ADDRESS

// Parse command line arguments
const args = process.argv.slice(2)
if (args.length < 1) {
  console.error('Usage: node index.js <snapshot-file> [batch-size]')
  console.error('  snapshot-file: JSON file with array of {address, id} objects')
  console.error('  batch-size: Number of reservations per transaction (2-100, default: 10)')
  process.exit(1)
}

const snapshotFile = args[0]
const batchSize = args[1] ? parseInt(args[1], 10) : 10

if (isNaN(batchSize) || batchSize < 2 || batchSize > 100) {
  console.error('Error: batch-size must be between 2 and 100')
  process.exit(1)
}

// Validate environment
if (!RPC_URL || !PRIVATE_KEY || !PROXY_ADDRESS) {
  console.error('Missing required environment variables in .env:')
  console.error('  RPC_URL:', RPC_URL ? 'set' : 'MISSING')
  console.error('  PRIVATE_KEY:', PRIVATE_KEY ? 'set' : 'MISSING')
  console.error('  PROXY_ADDRESS:', PROXY_ADDRESS ? 'set' : 'MISSING')
  process.exit(1)
}

// Read snapshot file
let snapshot
try {
  const content = readFileSync(snapshotFile, 'utf-8')
  snapshot = JSON.parse(content)
  if (!Array.isArray(snapshot)) {
    throw new Error('Snapshot must be an array')
  }
  console.log(`Loaded ${snapshot.length} entries from ${snapshotFile}`)
} catch (err) {
  console.error(`Error reading snapshot file: ${err.message}`)
  process.exit(1)
}

// Validate snapshot entries
for (let i = 0; i < snapshot.length; i++) {
  const entry = snapshot[i]
  if (!entry.address || !entry.id) {
    console.error(`Error: Entry ${i} missing 'address' or 'id' field`)
    process.exit(1)
  }
  if (typeof entry.id !== 'number' || entry.id < 1000000) {
    console.error(`Error: Entry ${i} has invalid token id: ${entry.id}`)
    process.exit(1)
  }
}

// Contract ABI (only what we need)
const abi = [
  {
    name: 'paused',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'puppersRemaining',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'totalReserved',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'indexToPupper',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'pupperToIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'hasRole',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'isReserved',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }]
  },
  {
    name: 'reserveTokensForMigration',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'recipients', type: 'address[]' }
    ],
    outputs: []
  },
  // Custom errors from PXV2 contract
  { name: 'ArraysLengthMismatch', type: 'error', inputs: [] },
  { name: 'EmptyArrays', type: 'error', inputs: [] },
  { name: 'BatchTooLarge', type: 'error', inputs: [] },
  { name: 'InvalidRecipient', type: 'error', inputs: [] },
  { name: 'InvalidTokenID', type: 'error', inputs: [] },
  { name: 'TokenIDOutOfRange', type: 'error', inputs: [] },
  { name: 'TokenAlreadyExists', type: 'error', inputs: [] },
  { name: 'TokenAlreadyReserved', type: 'error', inputs: [] },
  { name: 'TokenNotAvailableForMinting', type: 'error', inputs: [] },
  { name: 'NoPuppersRemainingForPoolRemoval', type: 'error', inputs: [] },
  { name: 'Overflow', type: 'error', inputs: [] },
  { name: 'TotalReservedOverflow', type: 'error', inputs: [] }
]

// DEFAULT_ADMIN_ROLE is bytes32(0)
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'

async function getChainId() {
  const client = createPublicClient({
    transport: http(RPC_URL)
  })
  return await client.getChainId()
}

async function main() {
  // Get chain ID and set up clients
  const chainId = await getChainId()
  console.log('Chain ID:', chainId)

  const chain = chainId === 8453 ? base : chainId === 84532 ? baseSepolia : { id: chainId, name: `Chain ${chainId}`, rpcUrls: { default: { http: [RPC_URL] } } }

  const account = privateKeyToAccount(PRIVATE_KEY)
  console.log('Signer:', account.address)
  console.log('Proxy:', PROXY_ADDRESS)
  console.log('Batch size:', batchSize)
  console.log()

  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL)
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL)
  })

  // Check if contract is paused
  console.log('Checking contract state...')
  const isPaused = await publicClient.readContract({
    address: PROXY_ADDRESS,
    abi,
    functionName: 'paused'
  })

  if (!isPaused) {
    console.error('Error: Contract is not paused. reserveTokensForMigration requires the contract to be paused.')
    process.exit(1)
  }
  console.log('  Contract is paused: OK')

  // Check if signer has DEFAULT_ADMIN_ROLE
  const hasAdminRole = await publicClient.readContract({
    address: PROXY_ADDRESS,
    abi,
    functionName: 'hasRole',
    args: [DEFAULT_ADMIN_ROLE, account.address]
  })

  if (!hasAdminRole) {
    console.error(`Error: Signer ${account.address} does not have DEFAULT_ADMIN_ROLE`)
    process.exit(1)
  }
  console.log('  Signer has DEFAULT_ADMIN_ROLE: OK')

  // Check pool state
  const puppersRemaining = await publicClient.readContract({
    address: PROXY_ADDRESS,
    abi,
    functionName: 'puppersRemaining'
  })
  const totalSupplyVal = await publicClient.readContract({
    address: PROXY_ADDRESS,
    abi,
    functionName: 'totalSupply'
  })
  const totalReserved = await publicClient.readContract({
    address: PROXY_ADDRESS,
    abi,
    functionName: 'totalReserved'
  })
  console.log(`  Puppers remaining: ${puppersRemaining}`)
  console.log(`  Total supply: ${totalSupplyVal}`)
  console.log(`  Total reserved: ${totalReserved}`)
  console.log(`  Available pool range: ${1000000n} to ${1000000n + puppersRemaining - 1n}`)

  // Warn about potential gas issues
  if (puppersRemaining > 100000n) {
    console.log()
    console.log('  WARNING: Large pool size detected!')
    console.log('  The contract does a linear search through the pool which may run out of gas.')
    console.log('  Consider processing tokens with IDs near INDEX_OFFSET first.')
  }
  console.log()

  // Check for tokens outside pool bounds (likely minted and burned on V1)
  const INDEX_OFFSET = 1000000n
  const poolUpperBound = INDEX_OFFSET + puppersRemaining - 1n
  const outOfBoundsTokens = []

  for (const entry of snapshot) {
    const tokenId = BigInt(entry.id)
    if (tokenId > poolUpperBound) {
      outOfBoundsTokens.push(entry.id)
    }
  }

  if (outOfBoundsTokens.length > 0) {
    console.error('ERROR: Snapshot contains tokens outside the current pool range!')
    console.error(`  Pool range: ${INDEX_OFFSET} to ${poolUpperBound}`)
    console.error(`  ${outOfBoundsTokens.length} token(s) exceed pool upper bound:`)
    for (const id of outOfBoundsTokens) {
      console.error(`    Token ${id}`)
    }
    console.error()
    console.error('These tokens were likely minted (and possibly burned) on V1 before the upgrade.')
    console.error('They have been permanently removed from the pool and cannot be reserved.')
    console.error('Please remove these tokens from the snapshot and re-run.')
    process.exit(1)
  }

  // Pre-check all tokens to filter out already reserved or existing ones
  console.log('Pre-checking token status...')
  const validEntries = []
  const skippedEntries = []

  for (const entry of snapshot) {
    const tokenId = BigInt(entry.id)

    // Check if token already exists (minted)
    let exists = false
    try {
      await publicClient.readContract({
        address: PROXY_ADDRESS,
        abi,
        functionName: 'ownerOf',
        args: [tokenId]
      })
      exists = true
    } catch {
      // ownerOf reverts if token doesn't exist, which is expected
      exists = false
    }

    if (exists) {
      skippedEntries.push({ ...entry, reason: 'already minted' })
      continue
    }

    // Check if token is already reserved
    const reserved = await publicClient.readContract({
      address: PROXY_ADDRESS,
      abi,
      functionName: 'isReserved',
      args: [tokenId]
    })

    if (reserved) {
      skippedEntries.push({ ...entry, reason: 'already reserved' })
      continue
    }

    validEntries.push(entry)
  }

  console.log(`  Valid tokens to reserve: ${validEntries.length}`)
  console.log(`  Skipped tokens: ${skippedEntries.length}`)

  if (skippedEntries.length > 0) {
    console.log('  Skipped details:')
    for (const entry of skippedEntries) {
      console.log(`    Token ${entry.id}: ${entry.reason}`)
    }
  }
  console.log()

  if (validEntries.length === 0) {
    console.log('No tokens to reserve. All tokens are already minted or reserved.')
    return
  }

  // Process in batches
  const totalBatches = Math.ceil(validEntries.length / batchSize)
  console.log(`Processing ${validEntries.length} reservations in ${totalBatches} batches...`)
  console.log()

  let successCount = 0
  let failCount = 0

  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const start = batchNum * batchSize
    const end = Math.min(start + batchSize, validEntries.length)
    const batch = validEntries.slice(start, end)

    const tokenIds = batch.map(e => BigInt(e.id))
    const recipients = batch.map(e => e.address)

    console.log(`Batch ${batchNum + 1}/${totalBatches}: reserving tokens ${start + 1}-${end} (${batch.length} tokens)`)

    try {
      // First try to simulate each token individually to find the failing one
      for (let j = 0; j < tokenIds.length; j++) {
        try {
          await publicClient.simulateContract({
            address: PROXY_ADDRESS,
            abi,
            functionName: 'reserveTokensForMigration',
            args: [[tokenIds[j]], [recipients[j]]],
            account: account.address
          })
        } catch (singleErr) {
          const tid = tokenIds[j]
          console.error(`  Token ${tid} would fail:`, singleErr.shortMessage || singleErr.message)

          // Diagnostic: check the pool state for this token
          try {
            const INDEX_OFFSET = 1000000n
            const poolUpperBound = INDEX_OFFSET + puppersRemaining - 1n

            // Check if token ID is beyond pool range
            if (tid > poolUpperBound) {
              console.error(`    DIAGNOSTIC: Token ID ${tid} > pool upper bound ${poolUpperBound}`)
              console.error(`    This token is OUTSIDE the pool range and cannot be found by linear search`)

              // Check what's stored at the token's natural index
              const valueAtNaturalIndex = await publicClient.readContract({
                address: PROXY_ADDRESS,
                abi,
                functionName: 'indexToPupper',
                args: [tid]
              })
              console.error(`    indexToPupper[${tid}] = ${valueAtNaturalIndex} (0 = MAGIC_NULL means token ${tid} was here)`)

              // Check pupperToIndex for this token
              const indexForToken = await publicClient.readContract({
                address: PROXY_ADDRESS,
                abi,
                functionName: 'pupperToIndex',
                args: [tid]
              })
              console.error(`    pupperToIndex[${tid}] = ${indexForToken}`)

              if (indexForToken > 0n && indexForToken < poolUpperBound) {
                // Token might have been moved to a different index
                const valueAtMovedIndex = await publicClient.readContract({
                  address: PROXY_ADDRESS,
                  abi,
                  functionName: 'indexToPupper',
                  args: [indexForToken]
                })
                console.error(`    indexToPupper[${indexForToken}] = ${valueAtMovedIndex}`)
              }
            }
          } catch (diagErr) {
            console.error(`    Diagnostic error:`, diagErr.message)
          }
        }
      }

      // Simulate the full batch
      await publicClient.simulateContract({
        address: PROXY_ADDRESS,
        abi,
        functionName: 'reserveTokensForMigration',
        args: [tokenIds, recipients],
        account: account.address
      })

      const hash = await walletClient.writeContract({
        address: PROXY_ADDRESS,
        abi,
        functionName: 'reserveTokensForMigration',
        args: [tokenIds, recipients]
      })

      console.log(`  Transaction sent: ${hash}`)

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      if (receipt.status === 'success') {
        console.log(`  Confirmed in block ${receipt.blockNumber}`)
        successCount += batch.length
      } else {
        console.error(`  Transaction reverted!`)
        failCount += batch.length
      }
    } catch (err) {
      // Try to extract detailed error info from viem
      console.error(`  Error: ${err.shortMessage || err.message}`)

      // Walk the error chain to find ContractFunctionRevertedError
      let revertError = null
      if (err.walk) {
        revertError = err.walk(e => e.name === 'ContractFunctionRevertedError')
      }

      if (revertError?.data?.errorName) {
        console.error(`  Revert reason: ${revertError.data.errorName}`)
        if (revertError.data.args && revertError.data.args.length > 0) {
          console.error(`  Error args: ${JSON.stringify(revertError.data.args)}`)
        }
      } else if (err.cause?.reason) {
        // For require() with string messages
        console.error(`  Revert reason: ${err.cause.reason}`)
      } else {
        // Show raw revert data if available (for manual decoding)
        const revertData = revertError?.signature || err.data?.data || err.cause?.data
        if (revertData && typeof revertData === 'string' && revertData.startsWith('0x')) {
          console.error(`  Raw revert data: ${revertData}`)
        }
      }

      // Additional debug: dump the full error structure
      console.error(`  Debug - Error name: ${err.name}`)
      if (err.cause) {
        console.error(`  Debug - Cause name: ${err.cause.name}`)
        console.error(`  Debug - Cause code: ${err.cause.code}`)
      }
      if (err.metaMessages) {
        console.error(`  Debug - Meta messages: ${err.metaMessages.join(', ')}`)
      }

      failCount += batch.length
    }

    console.log()
  }

  console.log('=== COMPLETE ===')
  console.log(`  Successful: ${successCount}`)
  console.log(`  Failed: ${failCount}`)
  console.log(`  Skipped (pre-check): ${skippedEntries.length}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
