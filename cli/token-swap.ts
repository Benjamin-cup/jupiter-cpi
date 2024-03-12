import {
  vault,
  provider,
  wallet,
  program,
  jupiterProgramId,
  connection,
  getAdressLookupTableAccounts,
  instructionDataToTransactionInstruction,
  execTx,
} from "./helper";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  SystemProgram,
  TransactionMessage,
  PublicKey,
  VersionedTransaction,
  SimulateTransactionConfig,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import fetch from "node-fetch";


const JUP_ENDPOINT = "https://quote-api.jup.ag/v6";

const USDC_ADDR = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP_ADDR = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const getQuote = async (
  fromMint: PublicKey,
  toMint: PublicKey,
  amount: number
) => {
  return fetch(
    `${JUP_ENDPOINT}/quote?outputMint=${toMint.toBase58()}&inputMint=${fromMint.toBase58()}&amount=${amount}&slippage=200&onlyDirectRoutes=true`
  ).then((response) => response.json());
};

const getSwapIx = async (
  user: PublicKey,
  quote: any
) => {
  const data = {
    quoteResponse: quote,
    userPublicKey: user.toBase58(),
    prioritizationFeeLamports: "auto"
  };
  return fetch(`${JUP_ENDPOINT}/swap-instructions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  }).then((response) => response.json());
};

const initialize = async () => {

  const transaction = await program.methods
    .initialize()
    .accounts({
      admin: wallet.publicKey,
      vault,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY
    })
    .transaction();

  const blockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash.blockhash;
  transaction.feePayer = wallet.publicKey;
  const signedTx = await wallet.signTransaction(transaction);

  try {
    await execTx(signedTx);
  } catch (e) {
    console.log(e);
  }
};

const tokenSwap = async (
  computeBudgetPayloads: any[],
  swapPayload: any,
  addressLookupTableAddresses: string[]
) => {
  let swapInstruction = instructionDataToTransactionInstruction(swapPayload);

  //  set pda not as a signer
  const vaultKey = swapInstruction.keys.find((x) => x.pubkey.toBase58() == vault.toBase58());
  vaultKey.isSigner = false;

  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 300000
  });

  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 2000
  });

  const instructions = [
    // ...computeBudgetPayloads.map(instructionDataToTransactionInstruction),
    addPriorityFee,
    modifyComputeUnits,
    await program.methods
      .tokenSwap(swapInstruction.data, Buffer.from("microgift"))
      .accounts({
        vault,
        
        jupiterProgram: jupiterProgramId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(swapInstruction.keys)
      .instruction(),
  ];

  // If you want, you can add more lookup table accounts here
  const addressLookupTableAccounts = await getAdressLookupTableAccounts(
    addressLookupTableAddresses
  );

  const blockhash = await connection.getLatestBlockhash();

  //  make versioned transaction
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions,
  }).compileToV0Message(addressLookupTableAccounts);
  
  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet.payer]);

  try {
    //  send and confirm the transaction
    await execTx(transaction);
  } catch (e) {
    console.log(e);
  }
};

// Main
(async () => {
  do {
    const tokenIn = new PublicKey(USDC_ADDR);
    const tokenOut = new PublicKey(JUP_ADDR);

    // Find the best Quote from the Jupiter API
    const quote = await getQuote(tokenIn, tokenOut, 1000000);
    // console.log({ quote });

    // Convert the Quote into a Swap instruction
    const result = await getSwapIx(vault, quote);

    if ("error" in result) {
      console.log({ result });
      return result;
    }

    // We have now both the instruction and the lookup table addresses.
    const {
      computeBudgetInstructions, // The necessary instructions to setup the compute budget.
      swapInstruction, // The actual swap instruction.
      addressLookupTableAddresses, // The lookup table addresses that you can use if you are using versioned transaction.
    } = result;

    await tokenSwap(
      computeBudgetInstructions,
      swapInstruction,
      addressLookupTableAddresses
    );

    await sleep(3000)
  } while (true)
})();


export const sleep = (time: number) => {
  return new Promise(resolve => setTimeout(resolve, time))
}