/**
 * This file specifies how to run the `SudokuZkApp` smart contract locally using the `Mina.LocalBlockchain()` method.
 * The `Mina.LocalBlockchain()` method specifies a ledger of accounts and contains logic for updating the ledger.
 *
 * Please note that this deployment is local and does not deploy to a live network.
 * If you wish to deploy to a live network, please use the zkapp-cli to deploy.
 *
 * To run locally:
 * Build the project: `$ npm run build`
 * Run with node:     `$ node build/src/run.js`.
 */
import { Sudoku, SudokuSolution, SudokuSolutionProof, SudokuZkApp } from './sudoku.js';
import { cloneSudoku, generateSudoku, solveSudoku } from './sudoku-lib.js';
import { AccountUpdate, EcdsaSignature, Encoding, ForeignCurve, Lightnet, MerkleMap, MerkleTree, Mina, PrivateKey, Provable, PublicKey, UInt8, fetchAccount } from 'o1js';
import { Abi, createPublicClient, createTestClient, createWalletClient, encodeFunctionData, getAddress, getContract, http, toHex, walletActions } from 'viem';
import { anvil } from 'viem/chains';
import paimaL2Abi from '@paima/evm-contracts/abi/PaimaL2Contract.json' with { type: 'json' };
import assert from 'assert';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { DelegateProgram, DelegateVerifyProgram, DelegationOrder, DelegationZkApp, Ecdsa, NoOpProgram, Secp256k1, DelegationContractData, UsesDelegationZkApp, encodeKey } from './delegate.js';

console.log('Event names:', Object.keys(SudokuZkApp.events));
console.log('Compiling ...');
console.time('compile');
// await SudokuSolution.compile();
// await SudokuZkApp.compile();
await DelegateProgram.compile();
// await DelegateVerifyProgram.compile();
// await NoOpProgram.compile();
await DelegationZkApp.compile();
await UsesDelegationZkApp.compile();
console.timeEnd('compile');

/** Scaling factor from human-friendly MINA amount to raw integer fee amount. */
const MINA_TO_RAW_FEE = 1_000_000_000;

// ----------------------------------------------------------------------------
// Connect to Lightnet
const lightnetAccountManagerEndpoint = 'http://localhost:8181';
Mina.setActiveInstance(
  Mina.Network({
    mina: 'http://localhost:8080/graphql',
    lightnetAccountManager: lightnetAccountManagerEndpoint,
  })
);

let lightnetAccount;
try {
  // ----------------------------------------------------------------------------
  // Connect to localhost Lightnet
  lightnetAccount = await Lightnet.acquireKeyPair({ lightnetAccountManagerEndpoint });
  const { publicKey: sender, privateKey: senderKey } = lightnetAccount;

  await Mina.waitForFunding(sender.toBase58());
  console.log('Sender balance:', Mina.activeInstance.getAccount(sender).balance.toBigInt());

  // ----------------------------------------------------------------------------
  const viemAccount = privateKeyToAccount(generatePrivateKey());
  const delegationOrder = new DelegationOrder({
    target: sender,
    signer: Secp256k1.fromHex(viemAccount.publicKey),
  });

  const delegationSignature = Ecdsa.fromHex(await viemAccount.signMessage({ message: { raw: delegationOrder.bytesToSign() } }));

  console.time('DelegateProgram.sign');
  const delegateProof = await DelegateProgram.sign(
    delegationOrder,
    delegationSignature,
  );
  console.timeEnd('DelegateProgram.sign');

  console.time('DelegateProgram.verify');
  console.log(await DelegateProgram.verify(delegateProof));
  console.timeEnd('DelegateProgram.verify');

  /*
  console.time('DelegateVerifyProgram.check');
  await DelegateVerifyProgram.check(delegateProof);
  console.timeEnd('DelegateVerifyProgram.check');

  console.time('NoOpProgram.blah');
  await NoOpProgram.blah(delegateProof.publicInput);
  console.timeEnd('NoOpProgram.blah');
  */

  const delegationKeys = PrivateKey.randomKeypair();
  const delegationApp = new DelegationZkApp(delegationKeys.publicKey);

  const userKeys = PrivateKey.randomKeypair();
  const userApp = new UsesDelegationZkApp(userKeys.publicKey);

  // deploy contracts
  console.time('deploy contracts');
  {
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        AccountUpdate.fundNewAccount(sender, 2);
        await delegationApp.deploy();
        await userApp.deploy();
      }
    );
    await tx.prove();
    await tx.sign([senderKey, delegationKeys.privateKey, userKeys.privateKey]).send().wait();
  }
  console.timeEnd('deploy contracts');

  // time recursive proof method
  console.log('UsesDelegationZkApp.viaRecursiveProof');
  console.time('UsesDelegationZkApp.viaRecursiveProof');
  {
    console.time('  tx');
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await userApp.viaRecursiveProof(delegateProof);
      }
    );
    console.timeEnd('  tx');
    console.time('  prove');
    await tx.prove();
    console.timeEnd('  prove');
    console.time('  sign and send');
    const sent = await tx.sign([senderKey, delegationKeys.privateKey, userKeys.privateKey]).send();
    console.timeEnd('  sign and send');
    console.time('  wait');
    await sent.wait();
    console.timeEnd('  wait');
  }
  console.timeEnd('UsesDelegationZkApp.viaRecursiveProof');

  // insert
  const data = new DelegationContractData();
  console.log('DelegationZkApp.delegate');
  console.time('DelegationZkApp.delegate');
  {
    const witness = data.delegate(delegationOrder);
    if (!witness)
      throw new Error('derp 1');

    console.time('  tx');
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await delegationApp.delegate(delegationOrder, witness, delegationSignature);
      }
    );
    console.timeEnd('  tx');
    console.time('  prove');
    await tx.prove();
    console.timeEnd('  prove');
    console.time('  sign and send');
    const sent = await tx.sign([senderKey]).send();
    console.timeEnd('  sign and send');
    console.time('  wait');
    await sent.wait();
    console.timeEnd('  wait');
  }
  console.timeEnd('DelegationZkApp.delegate');

  console.time('treeRoot.fetch');
  await delegationApp.treeRoot.fetch();
  await fetchAccount({ publicKey: delegationApp.address });
  console.timeEnd('treeRoot.fetch');

  // read directly
  console.log('DelegationZkApp.check');
  console.time('DelegationZkApp.check');
  {
    const witness = data.check(delegationOrder);
    if (!witness)
      throw new Error('derp 2');

    console.time('  tx');
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await delegationApp.check(delegationOrder, witness);
      }
    );
    console.timeEnd('  tx');
    console.time('  prove');
    await tx.prove();
    console.timeEnd('  prove');
    console.time('  sign and send');
    const sent = await tx.sign([senderKey]).send();
    console.timeEnd('  sign and send');
    console.time('  wait');
    await sent.wait();
    console.timeEnd('  wait');
  }
  console.timeEnd('DelegationZkApp.check');

  // read indirectly
  console.log('UsesDelegationZkApp.viaFriendContract');
  console.time('UsesDelegationZkApp.viaFriendContract');
  {
    const witness = data.check(delegationOrder);
    if (!witness)
      throw new Error('derp 2');

    console.time('  tx');
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await userApp.viaFriendContract(delegationApp.address, delegationOrder, witness);
      }
    );
    console.timeEnd('  tx');
    console.time('  prove');
    await tx.prove();
    console.timeEnd('  prove');
    console.time('  sign and send');
    const sent = await tx.sign([senderKey]).send();
    console.timeEnd('  sign and send');
    console.time('  wait');
    await sent.wait();
    console.timeEnd('  wait');
  }
  console.timeEnd('UsesDelegationZkApp.viaFriendContract');

  if ('a' < 'b')
    process.exit(0);

  // ----------------------------------------------------------------------------
  const sudoku = generateSudoku(0.5);
  const solution = solveSudoku(sudoku);
  if (solution === undefined) throw Error('Failed to solve randomly generated puzzle');

  // --------------------------------------------------------------------------
  // Use a ZkProgram to prove the solution
  console.log('Proving Sudoku solution...');
  // ZkPrograms make recursion possible, and also allow proofs to be created
  // and verified outside of the actual Mina blockchain transaction. We could
  // serialize `JSON.stringify(proof.toJSON())` and send that wherever and the
  // recipient could check it independently.
  const proof = await SudokuSolution.solve(Sudoku.from(sudoku), Sudoku.from(solution));
  const serializedProof = JSON.stringify(proof.toJSON());

  console.log('serializedProof.length =', serializedProof.length);

  console.log('Verifying deserialized proof...');
  const deserializedProof = await SudokuSolutionProof.fromJSON(JSON.parse(serializedProof));
  assert(await SudokuSolution.verify(deserializedProof));

  // --------------------------------------------------------------------------
  console.log('Posting proof to PaimaL2Contract');
  {
    const publicClient = createWalletClient({
      // This is one of Hardhat's well-known test private keys.
      account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
      chain: anvil,
      transport: http(),
    });

    const paimaL2 = getContract({
      abi: paimaL2Abi,
      address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',  // Good for localhost only
      client: publicClient,
    });

    const hash = await paimaL2.write.paimaSubmitGameInput([toHex(`sp|${serializedProof}`)], {
      value: 1n,
      gas: 1000000n,
    });
    console.log('Submitted hash:', hash);
  }

  // ----------------------------------------------------------------------------
  // Initialize our SudokuZkApp instance pointing to the preordained address.
  // In a real project, DON'T hardcode keys.

  const zkAppPrivateKey = PrivateKey.fromBase58(
    'EKFDbNM9k1ZTzYQCoUmqUSrBLoLLGzLtYJADP4P8ivxZnjNqUGGB'
  );
  const zkAppAddress = PublicKey.fromBase58(
    'B62qpwRxuV4vYFT8QLnrmB67FaKQemy54QH2XuBTyErr9wDDpLHTmQy'
  );
  if (zkAppPrivateKey.toPublicKey().toBase58() !== zkAppAddress.toBase58()) {
    throw new Error('zkAppPrivateKey and zkAppAddress mismatched');
  }
  const zkApp = new SudokuZkApp(zkAppAddress);

  // --------------------------------------------------------------------------
  // Deploy the contract to that address if it's not already there

  let fetchAccountResult;
  try {
    fetchAccountResult = await fetchAccount({ publicKey: zkApp.address });
  } catch (err) {
    // Work around fetchAccount bug(?) where it throws instead of returning an error code.
    fetchAccountResult = { account: undefined, error: err };
  }
  if (fetchAccountResult.account) {
    console.log('Contract appears to exist already. Not redeploying.');
  } else {
    console.log('Contract appears not to exist.', fetchAccountResult.error);

    try {
      console.log('Deploying contract: preparing...');
      const tx = await Mina.transaction(
        {
          sender,
          fee: 0.01 * MINA_TO_RAW_FEE,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender);
          await zkApp.deploy();
        }
      );
      console.log('Deploying contract: proving...');
      await tx.prove();

      console.log('Deploying contract: signing and sending...');

      /**
       * note: this tx needs to be signed with `tx.sign()`, because `deploy` uses `requireSignature()` under the hood,
       * so one of the account updates in this tx has to be authorized with a signature (vs proof).
       * this is necessary for the deploy tx because the initial permissions for all account fields are "signature".
       * (but `deploy()` changes some of those permissions to "proof" and adds the verification key that enables proofs.
       * that's why we don't need `tx.sign()` for the later transactions.)
       */
      const pending = await tx.sign([zkAppPrivateKey, senderKey]).send();
      console.log('Deploying contract: waiting for confirmation...');
      console.log('Included:', await pending.wait());
    } catch (err) {
      console.error(err);
      console.log('Error deploying contract; trying the rest anyways...');
    }
  }

  // --------------------------------------------------------------------------
  // Reset the puzzle

  {
    console.log('Resetting puzzle: preparing...');
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await zkApp.update(Sudoku.from(sudoku));
      }
    );
    console.log('Resetting puzzle: proving...');
    await tx.prove();
    console.log('Resetting puzzle: signing and sending...');
    const pending = await tx.sign([senderKey]).send();
    console.log('Resetting puzzle: waiting for confirmation...');
    console.log('Included:', await pending.wait());
  }

  await fetchAccount({ publicKey: zkApp.address });
  console.log('Is the sudoku solved?', zkApp.isSolved.get().toBoolean());

  // --------------------------------------------------------------------------
  // Submit a wrong solution
  const noSolution = cloneSudoku(solution);
  noSolution[0][0] = (noSolution[0][0] % 9) + 1;

  // Skip attempting to generate a SudokuSolution.solve proof for this solution
  // because it breaks `zkApp.isSolved.get().toBoolean()` below... somehow
  /*
  console.log('Attempting to prove wrong solution...');
  assert.rejects(async () => {
    await SudokuSolution.solve(Sudoku.from(sudoku), Sudoku.from(noSolution));
  });
  */

  console.log('Attempting to submit invalid proof...');
  const incorrectProof = new SudokuSolutionProof({
    ...proof,
    // Make the correct proof invalid by attempting to repurpose it for a
    // different Sudoku puzzle.
    publicInput: Sudoku.from(generateSudoku(0.5)),
  });
  try {
    let tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await zkApp.submitSolutionProof(incorrectProof);
      }
    );
    await tx.prove();
    await tx.sign([senderKey]).send();
  } catch (err) {
    console.log('There was an error submitting the solution, as expected');
  }

  await fetchAccount({ publicKey: zkApp.address });
  console.log('Is the sudoku solved?', zkApp.isSolved.get().toBoolean());

  // --------------------------------------------------------------------------
  // Submit the actual solution
  {
    console.log('Submitting solution: preparing...');
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        // The proof object bundles the public input (puzzle to be solved) so we
        // don't need to pass it again.
        await zkApp.submitSolutionProof(proof);
      }
    );
    console.log('Submitting solution: proving...');
    await tx.prove();
    console.log('Submitting solution: signing and sending...');
    const pending = await tx.sign([senderKey]).send();
    console.log('Submitting solution: waiting for confirmation...');
    console.log('Included:', await pending.wait());
  }

  await fetchAccount({ publicKey: zkApp.address });
  console.log('Is the sudoku solved?', zkApp.isSolved.get().toBoolean());

  // ----------------------------------------------------------------------------
  // Disconnect from Lightnet
} finally {
  if (lightnetAccount) {
    const releaseResult = await Lightnet.releaseKeyPair({
      publicKey: lightnetAccount.publicKey.toBase58(),
      lightnetAccountManagerEndpoint,
    });
    if (!releaseResult) {
      console.error('Failed to release lightnet keypair');
    }
  }
}
