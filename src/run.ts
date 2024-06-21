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
import { AccountUpdate, Lightnet, Mina, PrivateKey, fetchAccount } from 'o1js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { DelegateProgram, DelegationContractData, DelegationOrder, DelegationZkApp, Ecdsa, Secp256k1, UsesDelegationZkApp } from './delegate.js';

console.log('Compiling ...');
console.time('compile');
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
