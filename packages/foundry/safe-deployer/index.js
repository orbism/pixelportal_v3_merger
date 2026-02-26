import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import dotenv from 'dotenv'
import { createPublicClient, http } from 'viem'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env from parent directory
dotenv.config({ path: resolve(import.meta.dirname, '../.env') })

const RPC_URL = process.env.RPC_URL
const SAFE_ADDRESS = process.env.MULTISIG
const OWNER_PRIVATE_KEY = process.env.PRIVATE_KEY
const TARGET_CONTRACT = process.env.PROXY_ADDRESS

// Get calldata filename from command line
const calldataFile = process.argv[2]
if (!calldataFile) {
  console.error('Usage: node index.js <calldata-file>')
  console.error('  The calldata file should contain hex-encoded calldata (0x...)')
  process.exit(1)
}

// Read calldata from file
const CALLDATA = readFileSync(calldataFile, 'utf-8').trim()

if (!RPC_URL || !SAFE_ADDRESS || !OWNER_PRIVATE_KEY || !TARGET_CONTRACT || !process.env.SAFE_API_KEY) {
  console.error('Missing required environment variables in .env:')
  console.error('  RPC_URL:', RPC_URL ? 'set' : 'MISSING')
  console.error('  MULTISIG:', SAFE_ADDRESS ? 'set' : 'MISSING')
  console.error('  PRIVATE_KEY:', OWNER_PRIVATE_KEY ? 'set' : 'MISSING')
  console.error('  PROXY_ADDRESS:', TARGET_CONTRACT ? 'set' : 'MISSING')
  console.error('  SAFE_API_KEY:', process.env.SAFE_API_KEY ? 'set' : 'MISSING')
  process.exit(1)
}

async function getChainId() {
  const client = createPublicClient({
    transport: http(RPC_URL)
  })
  return await client.getChainId()
}

async function proposeTransaction() {
  // Query chain ID from RPC
  const chainId = await getChainId()
  console.log('Chain ID:', chainId)
  console.log('RPC URL:', RPC_URL)
  console.log('Safe Address:', SAFE_ADDRESS)
  console.log('Target Contract:', TARGET_CONTRACT)
  console.log('Calldata:', CALLDATA)
  console.log()

  // Initialize Protocol Kit (for signing)
  const protocolKit = await Safe.init({
    provider: RPC_URL,
    signer: OWNER_PRIVATE_KEY,
    safeAddress: SAFE_ADDRESS
  })

  // Initialize API Kit (for submitting to Safe service)
  const apiKit = new SafeApiKit({
    chainId: BigInt(chainId),
    apiKey: process.env.SAFE_API_KEY
  })

  // Create the transaction
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [{
      to: TARGET_CONTRACT,
      data: CALLDATA,
      value: '0'
    }]
  })

  // Sign it
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction)
  const signature = await protocolKit.signHash(safeTxHash)

  // Get signer address
  const externalSigner = await protocolKit.getSafeProvider().getExternalSigner()
  const signerAddresses = await externalSigner.getAddresses()
  const signerAddress = signerAddresses[0]

  // Propose to the Safe Transaction Service
  await apiKit.proposeTransaction({
    safeAddress: SAFE_ADDRESS,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: signerAddress,
    senderSignature: signature.data
  })

  console.log('Transaction proposed!')
  console.log('Safe TX Hash:', safeTxHash)

  // Determine the network prefix for Safe UI
  const networkPrefix = chainId === 8453 ? 'base' : chainId === 84532 ? 'basesep' : `chain-${chainId}`
  console.log('View in Safe UI: https://app.safe.global/transactions/queue?safe=' + networkPrefix + ':' + SAFE_ADDRESS)
}

proposeTransaction().catch(console.error)
