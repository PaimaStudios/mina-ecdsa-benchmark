/**
 * Compares approaches (see `delegate.ts`):
 *   - control
 *   - program
 *   - merkle
 * at tasks:
 *   - compile
 *   - prove
 *   - check
 *
 * To build and run against Lightnet: `npm start`.
 */
import { AccountUpdate, Lightnet, Mina, PrivateKey, fetchAccount } from 'o1js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { DelegateProgram, DelegationContractData, DelegationOrder, DelegationZkApp, Ecdsa, NoOpProgram, Secp256k1, UserZkApp } from './delegate.js';

async function measure<R>(name: string, body: () => Promise<R>): Promise<[number, R]> {
  const start = new Date().valueOf();
  const r = await body();
  const duration = (new Date().valueOf() - start) / 1000;
  console.log(name, ':', duration, 's');
  return [duration, r];
}

const forceRecompile = false;
const [controlCompileTime,] = await measure('NoOpProgram.compile', () => NoOpProgram.compile({ forceRecompile }));
const [programCompileTime,] = await measure('DelegateProgram.compile', () => DelegateProgram.compile({ forceRecompile }));
const [merkleCompileTime,] = await measure('DelegationZkApp.compile', () => DelegationZkApp.compile({ forceRecompile }));
await measure('UserZkApp.compile', () => UserZkApp.compile());

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

  // ----------------------------------------------------------------------------
  // Set up the delegation order we are going to be proving.
  const viemAccount = privateKeyToAccount(generatePrivateKey());
  const delegationOrder = new DelegationOrder({
    target: sender,
    signer: Secp256k1.fromHex(viemAccount.publicKey),
  });
  // Sign the order with our EVM wallet. Like a user would be prompted to do.
  const delegationSignature = Ecdsa.fromHex(await viemAccount.signMessage({ message: { raw: delegationOrder.bytesToSign() } }));

  const delegationContractData = new DelegationContractData();

  // ----------------------------------------------------------------------------
  // control prove
  const [controlProveTime,] = await measure('NoOpProgram.doNothing', () => NoOpProgram.doNothing());

  // ----------------------------------------------------------------------------
  // program prove
  const [programProveTime, delegateProof] = await measure('DelegateProgram.sign', () =>
    DelegateProgram.sign(
      delegationOrder,
      delegationSignature,
    )
  );

  await measure('DelegateProgram.verify', () => DelegateProgram.verify(delegateProof));

  // ----------------------------------------------------------------------------
  // deploy contracts
  const delegationKeys = PrivateKey.randomKeypair();
  const delegationApp = new DelegationZkApp(delegationKeys.publicKey);

  const userKeys = PrivateKey.randomKeypair();
  const userApp = new UserZkApp(userKeys.publicKey);

  await measure('deploy contracts', async () => {
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
  });

  // ----------------------------------------------------------------------------
  // control check
  const [, controlCheckTime] = await measure('UserZkApp.noOp', async () => {
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await userApp.noOp();
      }
    );
    const [proveTime,] = await measure('┌ prove', () => tx.prove());
    await tx.sign([senderKey]).send().wait();
    return proveTime;
  });

  // ----------------------------------------------------------------------------
  // program check
  const [, programCheckTime] = await measure('UserZkApp.viaRecursiveProof', async () => {
    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await userApp.viaRecursiveProof(delegateProof);
      }
    );
    const [proveTime,] = await measure('┌ prove', () => tx.prove());
    await tx.sign([senderKey]).send().wait();
    return proveTime;
  });

  // ----------------------------------------------------------------------------
  // merkle prove
  const [, merkleProveTime] = await measure('DelegationZkApp.delegate', async () => {
    const witness = delegationContractData.delegate(delegationOrder);
    if (!witness)
      throw new Error();

    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await delegationApp.delegate(delegationOrder, witness, delegationSignature);
      }
    );
    const [proveTime,] = await measure('┌ prove', () => tx.prove());
    await tx.sign([senderKey]).send().wait();
    return proveTime;
  });

  await measure('fetchAccount', () => fetchAccount({ publicKey: delegationApp.address }));

  // ----------------------------------------------------------------------------
  // merkle check
  await measure('DelegationZkApp.check', async () => {
    const witness = delegationContractData.check(delegationOrder);
    if (!witness)
      throw new Error();

    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await delegationApp.check(delegationOrder, witness);
      }
    );
    await measure('┌ prove', () => tx.prove());
    await tx.sign([senderKey]).send().wait();
  });

  // read indirectly
  const [, merkleCheckTime] = await measure('UserZkApp.viaFriendContract', async () => {
    const witness = delegationContractData.check(delegationOrder);
    if (!witness)
      throw new Error();

    const tx = await Mina.transaction(
      {
        sender,
        fee: 0.01 * MINA_TO_RAW_FEE,
      },
      async () => {
        await userApp.viaFriendContract(delegationApp.address, delegationOrder, witness);
      }
    );
    const [proveTime,] = await measure('┌ prove', () => tx.prove());
    await tx.sign([senderKey]).send().wait();
    return proveTime;
  });

  // ----------------------------------------------------------------------------
  // Summarize results
  console.log('---');
  function margin(a: number, b: number) {
    return `${((1 - Math.min(a, b) / Math.max(a, b)) * 100).toFixed(1)}%`;
  }
  const table = [
    ['Control:', controlCompileTime.toFixed(2), controlProveTime.toFixed(2), controlCheckTime.toFixed(2)],
    ['Program:', programCompileTime.toFixed(2), programProveTime.toFixed(2), programCheckTime.toFixed(2)],
    ['Merkle:', merkleCompileTime.toFixed(2), merkleProveTime.toFixed(2), merkleCheckTime.toFixed(2)],
    [
      'Winner:',
      programCompileTime < merkleCompileTime ? 'program' : 'merkle',
      programProveTime < merkleProveTime ? 'program' : 'merkle',
      programCheckTime < merkleCheckTime ? 'program' : 'merkle',
    ],
    [
      'Margin:',
      margin(programCompileTime, merkleCompileTime),
      margin(programProveTime, merkleProveTime),
      margin(programCheckTime, merkleCheckTime),
    ],
  ];
  const widths: number[] = [];
  for (const row of table) {
    for (let i = 0; i < row.length; ++i) {
      widths[i] = Math.max(widths[i] ?? 0, String(row[i]).length);
    }
  }
  for (const row of table) {
    console.log(...row.map((e, i) => String(e).padStart(widths[i], ' ')));
  }

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
