import {
  Field,
  SmartContract,
  method,
  Bool,
  state,
  State,
  Poseidon,
  Struct,
  Provable,
  PublicKey,
  ZkProgram,
  MerkleMap,
  createEcdsa,
  createForeignCurve,
  Crypto,
  Bytes,
  UInt8,
  MerkleMapWitness,
} from 'o1js';

// ----------------------------------------------------------------------------
// Common data types

export class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {
  /** Convert a standard 0x04{128 hex digits} public key into this provable struct. */
  static fromHex(publicKey: `0x${string}`): Secp256k1 {
    if (!publicKey.startsWith('0x04') || publicKey.length != 4 + 64 + 64) {
      throw new Error('Bad public key format');
    }
    return Secp256k1.from({
      x: BigInt('0x' + publicKey.substring(4, 4 + 64)),
      y: BigInt('0x' + publicKey.substring(4 + 64, 4 + 64 + 64)),
    });
  }
}

export class Ecdsa extends createEcdsa(Secp256k1) {
  // o1js-provided fromHex is good enough
}

const ethereumPrefix = Bytes.fromString('\x19Ethereum Signed Message:\n');
const delegationPrefix = Bytes.fromString('MinaDelegate|');

/**
 * An order that a particular EVM address has signed to authorize (delegate)
 * a Mina address to act on its behalf.
 */
export class DelegationOrder extends Struct({
  /** Mina public key that the delegation order is issued for. */
  target: PublicKey,
  /** Ethereum public key that signed the delegation order. */
  signer: Secp256k1.provable,
}) {
  private _innerMessage(): Bytes {
    return Bytes.from([
      ...delegationPrefix.bytes,
      ...encodeKey(this.target),
    ]);
  }

  /** Get the message for an Etherum wallet to sign, WITHOUT the Ethereum prefix. */
  bytesToSign(): Uint8Array {
    return this._innerMessage().toBytes();
  }

  /** Validate that the given Ethereum signature matches this order, WITH the Ethereum prefix. */
  assertSignatureMatches(signature: Ecdsa) {
    const inner = this._innerMessage();
    const fullMessage = Bytes.from([
      ...ethereumPrefix.bytes,
      ...Bytes.fromString(String(inner.length)).bytes,
      ...inner.bytes,
    ]);
    signature.verifyV2(fullMessage, this.signer).assertTrue();
  }

  /** Hash this entire order for use as a MerkleMap key. */
  hash() {
    return Poseidon.hashWithPrefix(
      'DelegationOrder',
      [
        ...this.target.toFields(),
        ...this.signer.x.toFields(),
        ...this.signer.y.toFields(),
      ]
    );
  }
}

function encodeKey(k: PublicKey): UInt8[] {
  const bytes = [boolToU8(k.isOdd)];
  const bits = k.x.toBits(/* implied 254 */);
  for (let i = 0; i < bits.length; i += 8) {
    let value = new UInt8(0);
    for (let j = 0; j < 8; j++) {
      value = value.mul(2).add(boolToU8(bits[i + j] ?? Bool(false)));
    }
    bytes.push(value);
  }
  return bytes;
}

function boolToU8(bool: Bool): UInt8 {
  return UInt8.from(bool.toField());
}

// ----------------------------------------------------------------------------
// Control: no-op programs and contracts

export const NoOpProgram = ZkProgram({
  name: 'NoOpProgram',

  methods: {
    doNothing: {
      privateInputs: [],

      async method() {}
    }
  }
});

// ----------------------------------------------------------------------------
// Approach 1 "program": a recursive proof that a valid ECDSA signature exists
// for a delegation order.

export const DelegateProgram = ZkProgram({
  name: 'DelegateProgram',

  publicInput: DelegationOrder,

  methods: {
    sign: {
      privateInputs: [Ecdsa.provable],

      async method(
        order: DelegationOrder,
        signature: Ecdsa,
      ) {
        order.assertSignatureMatches(signature);
      }
    }
  }
});
export class DelegateProof extends ZkProgram.Proof(DelegateProgram) {}

export const DelegateVerifyProgram = ZkProgram({
  name: 'DelegateVerifyProgram',

  publicOutput: DelegationOrder,

  methods: {
    check: {
      privateInputs: [DelegateProof],

      async method(
        proof: DelegateProof
      ): Promise<DelegationOrder> {
        Provable.asProver(() => console.time('proof.verify'));
        proof.verify();
        Provable.asProver(() => console.timeEnd('proof.verify'));
        return proof.publicInput;
      }
    }
  }
});

// ----------------------------------------------------------------------------
// Approach 2 "merkle": a contract with a MerkleMap that stores a set of
// delegation orders for which a valid ECDSA signature has been shown to exist.

// Outside of this benchmark, this would need to be calculated from the event
// history of an archive node to be able to make valid inserts or queries.
export class DelegationContractData {
  map = new MerkleMap();

  /** Prepare to prove a new delegation order. Returns undefined if it's already in the tree. */
  delegate(order: DelegationOrder): MerkleMapWitness | undefined {
    const key = order.hash();

    if (this.map.get(key).equals(0).not().toBoolean()) {
      return undefined;
    }

    this.map.set(key, Field(1));

    return this.map.getWitness(key);
  }

  /** Prepare to prove an existing delegation order. Returns undefined if it's not in the tree. */
  check(order: DelegationOrder): MerkleMapWitness | undefined {
    const key = order.hash();

    if (this.map.get(key).equals(0).toBoolean()) {
      return undefined;
    }

    return this.map.getWitness(key);
  }
}

const emptyMapRoot = new MerkleMap().getRoot();

export class DelegationZkApp extends SmartContract {
  @state(Field) treeRoot = State<Field>(emptyMapRoot);

  static events = {
    "delegate": DelegationOrder,
  } as const;
  events = DelegationZkApp.events;

  @method async init() {
    super.init();
  }

  @method async delegate(
    order: DelegationOrder,
    witness: MerkleMapWitness,
    evmSignature: Ecdsa,
  ) {
    // Firstly, check EVM signature.
    order.assertSignatureMatches(evmSignature);

    // Assert that the witness matches our idea of the old (0, false) value.
    const [root, key] = witness.computeRootAndKey(Field(0));
    this.treeRoot.getAndRequireEquals().assertEquals(root);
    order.hash().assertEquals(key);

    // Update to the new (1, true) value.
    const [newRoot,] = witness.computeRootAndKey(Field(1));
    this.treeRoot.set(newRoot);

    this.emitEvent("delegate", order);
  }

  @method async check(
    order: DelegationOrder,
    witness: MerkleMapWitness,
  ) {
    // Assert that the witness matches our idea of the (1, true) value.
    const [root, key] = witness.computeRootAndKey(Field(1));
    this.treeRoot.getAndRequireEquals().assertEquals(root);
    order.hash().assertEquals(key);
  }
}

// ----------------------------------------------------------------------------
// "User" contract, for all approaches. In addition to verifying the delegation
// order, also requires that the sender matches the Mina half of the order.

export class UserZkApp extends SmartContract {
  // Control
  @method async noOp() {}

  // Approach 1
  @method async viaRecursiveProof(
    proof: DelegateProof,
  ) {
    proof.publicInput.target.assertEquals(this.sender.getAndRequireSignature());

    proof.verify();
  }

  // Approach 2
  @method async viaFriendContract(
    friendAddr: PublicKey,
    order: DelegationOrder,
    witness: MerkleMapWitness,
  ) {
    order.target.assertEquals(this.sender.getAndRequireSignature());

    const friend = new DelegationZkApp(friendAddr);
    await friend.check(order, witness);
  }
}
