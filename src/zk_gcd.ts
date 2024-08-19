import { Bool, Proof, Provable, SelfProof, Struct, ZkProgram } from "o1js";
import { Big } from "./bigint.js";

class GcdInput extends Struct({
  lhs: Big,
  rhs: Big,
}) {}

class GcdOutput extends Struct({
  lhs_negative: Bool,
  g_0: Big,
  g_1: Big,
  s_0: Big,
  s_1: Big,
}) {
  assertSolved(): { g: Big; s: Big } {
    this.g_1.assertEquals(Big.ZERO);
    return {
      g: this.g_0,
      s: new Big(Provable.if(this.lhs_negative, Big, this.s_0.neg(), this.s_0)),
    };
  }
}

const GCD_ITERATIONS_PER_PROOF = 1;

function gcdIterateJustOnce(progress: GcdOutput): GcdOutput {
  let { lhs_negative, g_0, g_1, s_0, s_1 } = progress;
  g_1.assertNotEquals(Big.ZERO);

  // a %= b
  const { quot, rem } = g_0.floorDiv(progress.g_1);
  [g_0, g_1] = [g_1, rem];

  [s_0, s_1] = [s_1, s_0.sub(quot.mul(s_1))];

  return new GcdOutput({ lhs_negative, g_0, g_1, s_0, s_1 });
}

function gcdIterateSeveral(progress: GcdOutput): GcdOutput {
  //progress.isSolved().assertFalse();

  let result = (progress = new GcdOutput(progress));
  let solved = Bool(false);

  for (let i = 0; i < GCD_ITERATIONS_PER_PROOF; ++i) {
    const isZero = progress.g_1.equals(Big.ZERO);
    const newlySolved = solved.not().and(isZero);
    solved = solved.or(newlySolved);

    result = new GcdOutput(
      Provable.if(newlySolved, GcdOutput, progress, result)
    );

    // a %= b
    const { quot, rem } = progress.g_0.floorDiv(
      new Big(Provable.if(isZero, Big, Big.ONE, progress.g_1))
    );
    [progress.g_0, progress.g_1] = [progress.g_1, rem];

    [progress.s_0, progress.s_1] = [
      progress.s_1,
      progress.s_0.sub(quot.mul(progress.s_1)),
    ];
  }

  return new GcdOutput(Provable.if(solved, GcdOutput, result, progress));
}

const gcdIterate =
  GCD_ITERATIONS_PER_PROOF == 1 ? gcdIterateJustOnce : gcdIterateSeveral;

export const GcdProgram = ZkProgram({
  name: "Gcd",
  publicInput: GcdInput,
  publicOutput: GcdOutput,
  methods: {
    start: {
      privateInputs: [],
      async method(input: GcdInput): Promise<GcdOutput> {
        return gcdIterate(
          new GcdOutput({
            lhs_negative: input.lhs.negative,
            g_0: input.lhs.abs(),
            g_1: input.rhs.abs(),
            s_0: Big.ONE,
            s_1: Big.ZERO,
          })
        );
      },
    },
    continue: {
      privateInputs: [SelfProof<GcdInput, GcdOutput>],
      async method(
        input: GcdInput,
        progress: SelfProof<GcdInput, GcdOutput>
      ): Promise<GcdOutput> {
        input.lhs.assertEquals(progress.publicInput.lhs);
        input.rhs.assertEquals(progress.publicInput.rhs);
        return gcdIterate(progress.publicOutput);
      },
    },
  },
});

export class GcdProof extends Proof<GcdInput, GcdOutput> {}

export async function gcd(lhs: Big, rhs: Big): Promise<GcdProof> {
  const input = new GcdInput({ lhs, rhs });
  console.log("input=", JSON.stringify(input));
  let proof = await GcdProgram.start(input);
  let i = 1;
  while (!proof.publicOutput.g_1.equals(Big.ZERO).toBoolean()) {
    console.log("progress=", JSON.stringify(proof.publicOutput));
    proof = await GcdProgram.continue(input, proof);
    ++i;
  }
  console.log("final progress=", JSON.stringify(proof.publicOutput));
  console.log(
    i,
    "*",
    GCD_ITERATIONS_PER_PROOF,
    "iters for gcd(",
    lhs.toBigInt(),
    ", ",
    rhs.toBigInt(),
    ")"
  );
  return proof;
}
