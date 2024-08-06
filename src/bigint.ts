// ----------------------------------------------------------------------------
import { Bool, Field, Gadgets, Provable, Struct, Unconstrained } from "o1js";

// Should be kept less than half of Mina's 254 to make carry easy to handle.
const LIMB_BITS = 116;
// Increase this to make Big bigger.
const LIMB_NUM = 36;

const MODULUS = 1n << BigInt(LIMB_BITS);
const MASK = MODULUS - 1n;

const Limbs = Provable.Array(Field, LIMB_NUM);

enum Ordering {
  Less,
  Equal,
  Greater,
}

export class Big extends Struct({
  // Little-endian: [0] is least significant, [17] is most significant
  fields: Limbs,
  value: Unconstrained.withEmpty(0n),
}) {
  // --------------------------------------------------------------------------
  // Get in & out of provable world

  static from(x: bigint) {
    let fields = [];
    let value = x;
    for (let i = 0; i < LIMB_NUM; i++) {
      fields.push(Field(x & MASK));
      x >>= BigInt(LIMB_BITS);
    }
    if (x !== 0n && x !== -1n) throw new Error("leftover: " + x);
    return new Big({ fields, value: Unconstrained.from(value) });
  }

  static readonly MAX = Big.from((1n << BigInt(LIMB_BITS * LIMB_NUM)) - 1n);
  static readonly ZERO = Big.from(0n);
  static readonly ONE = Big.from(1n);

  static check(x: { fields: Field[] }) {
    for (let i = 0; i < LIMB_NUM; i++) {
      rangeCheck116(x.fields[i]);
    }
  }

  toBigInt(): bigint {
    return this.value.get();
  }

  // --------------------------------------------------------------------------
  // Bit manipulation

  toBits(): Bool[] {
    const r = [];
    for (let i = 0; i < LIMB_NUM; i++) {
      r.push(...this.fields[i].toBits(LIMB_BITS));
    }
    return r;
  }

  // --------------------------------------------------------------------------
  // Bignum math

  add(y: Big): Big {
    let fields = Limbs.empty();
    let carry = Bool(false);

    for (let i = 0; i < LIMB_NUM; i++) {
      fields[i] = this.fields[i].add(y.fields[i]).add(carry.toField());
      carry = fields[i].greaterThan(MASK);
      fields[i] = Provable.if(
        carry,
        Field,
        fields[i].sub(MASK + 1n),
        fields[i]
      );
    }

    carry.assertFalse();
    // TODO: is this Unconstrained correct?
    return new Big({
      fields,
      value: Unconstrained.from(this.value.get() + y.value.get()),
    });
  }

  sub(y: Big): Big {
    console.log(this.toBigInt(), "-", y.toBigInt());
    y.assertLessThanOrEqual(this);

    let fields = Limbs.empty();
    let carry = Bool(false);

    for (let i = 0; i < LIMB_NUM; i++) {
      fields[i] = this.fields[i].sub(y.fields[i]).sub(carry.toField());
      carry = fields[i].greaterThan(MASK);
      fields[i] = Provable.if(carry, Field, fields[i].add(MODULUS), fields[i]);
    }

    carry.assertFalse();
    // TODO: is this Unconstrained correct?
    return new Big({
      fields,
      value: Unconstrained.from(this.value.get() - y.value.get()),
    });
  }

  mul(y: Big): Big {
    return Big.MAX.modMul(this, y);
  }

  square(): Big {
    return Big.MAX.modSquare(this);
  }

  floorDiv(y: Big): { q: Big; r: Big } {
    // this = q * y + r
    const { q, r } = Provable.witness(Struct({ q: Big, r: Big }), () => {
      const q = this.toBigInt() / y.toBigInt();
      const r = this.toBigInt() % y.toBigInt();
      return { q: Big.from(q), r: Big.from(r) };
    });

    console.log(
      this.toBigInt(),
      "=",
      q.toBigInt(),
      "*",
      y.toBigInt(),
      "+",
      r.toBigInt()
    );

    q.assertLessThanOrEqual(this);
    r.assertLessThan(y);
    r.assertLessThanOrEqual(this);
    y.mul(q).add(r).assertEquals(this);
    return { q, r };
  }

  powField(exponent: Field): Big {
    const bits = exponent.toBits();
    let result = Big.from(1n);
    let squares: Big = this;
    for (let i = 0; i < bits.length; ++i) {
      result = new Big(Provable.if(bits[i], Big, result.mul(squares), result));
      squares = squares.mul(squares);
    }
    return result;
  }

  gcd(b: Big): Big {
    let solved = Bool(false);
    let result = Big.ZERO;
    let a: Big = this;
    for (let i = 0; i < 20; ++i) {
      // if b == 0, return a
      const bZero = b.equals(Big.ZERO);
      const bNewlySolved = solved.not().and(bZero);
      solved = solved.or(bNewlySolved);
      result = new Big(Provable.if(bNewlySolved, Big, a, result));

      // a %= b
      a = a.floorDiv(new Big(Provable.if(bZero, Big, Big.ONE, b))).r;

      // if a == 0, return b
      const aZero = a.equals(Big.ZERO);
      const aNewlySolved = solved.not().and(aZero);
      solved = solved.or(aNewlySolved);
      result = new Big(Provable.if(aNewlySolved, Big, b, result));

      // b %= a
      b = b.floorDiv(new Big(Provable.if(aZero, Big, Big.ONE, a))).r;
    }
    solved.assertTrue();
    console.log('gcd(', this.toBigInt(), ',', b.toBigInt(), ')=', result.toBigInt());
    return result;
  }

  // --------------------------------------------------------------------------
  // RSA-style modulus math

  modMul(x: Big, y: Big): Big {
    return multiply(x, y, this);
  }

  modSquare(x: Big): Big {
    return multiply(x, x, this, { isSquare: true });
  }

  // --------------------------------------------------------------------------
  // Comparisons and asserts

  cmp(other: Big): Field /* in Ordering */ {
    let state = Field(Ordering.Equal);
    for (let i = LIMB_NUM - 1; i >= 0; --i) {
      state = Provable.switch(
        [
          state.equals(Ordering.Less),
          state
            .equals(Ordering.Equal)
            .and(this.fields[i].lessThan(other.fields[i])),
          state
            .equals(Ordering.Equal)
            .and(this.fields[i].equals(other.fields[i])),
          state
            .equals(Ordering.Equal)
            .and(this.fields[i].greaterThan(other.fields[i])),
          state.equals(Ordering.Greater),
        ],
        Field,
        [
          Field(Ordering.Less),
          Field(Ordering.Less),
          Field(Ordering.Equal),
          Field(Ordering.Greater),
          Field(Ordering.Greater),
        ]
      );
    }
    return state;
  }

  equals(other: Big): Bool {
    return this.cmp(other).equals(Ordering.Equal);
  }

  assertLessThan(other: Big): void {
    this.cmp(other).assertEquals(Ordering.Less);
  }

  assertLessThanOrEqual(other: Big): void {
    this.cmp(other).assertNotEquals(Ordering.Greater);
  }

  assertEquals(other: Big): void {
    for (let i = 0; i < LIMB_NUM; ++i) {
      this.fields[i].assertEquals(other.fields[i]);
    }
  }
}

function floor_div(x: Field, y: Field): [quotient: Field, remainder: Field] {
  const [q, r] = Provable.witnessFields(2, () => {
    const q = x.toBigInt() / y.toBigInt();
    const r = x.toBigInt() % y.toBigInt();
    return [q, r];
  });
  //q.assertGreaterThanOrEqual(0);
  q.assertLessThan(x);
  //r.assertGreaterThanOrEqual(0);
  r.assertLessThan(y);
  r.assertLessThan(x);
  y.mul(q).add(r).assertEquals(x);
  return [q, r];
}

/**
 * x*y mod p
 */
function multiply(x: Big, y: Big, p: Big, { isSquare = false } = {}) {
  if (isSquare) y = x;

  // witness q, r so that x*y = q*p + r
  // this also adds the range checks in `check()`
  let { q, r } = Provable.witness(
    // TODO Struct() should be unnecessary
    Struct({ q: Big, r: Big }),
    () => {
      let xy = x.toBigInt() * y.toBigInt();
      let p0 = p.toBigInt();
      let q = xy / p0;
      let r = xy - q * p0;
      return { q: Big.from(q), r: Big.from(r) };
    }
  );

  // compute delta = xy - qp - r
  // we can use a sum of native field products for each limb, because
  // input limbs are range-checked to 116 bits, and 2*116 + log(2*18-1) = 232 + 6 fits the native field.
  let delta: Field[] = Array.from({ length: 2 * LIMB_NUM - 1 }, () => Field(0));
  let [X, Y, Q, R, P] = [x.fields, y.fields, q.fields, r.fields, p.fields];

  for (let i = 0; i < LIMB_NUM; i++) {
    // when squaring, we can save constraints by not computing xi * xj twice
    if (isSquare) {
      for (let j = 0; j < i; j++) {
        delta[i + j] = delta[i + j].add(X[i].mul(X[j]).mul(2n));
      }
      delta[2 * i] = delta[2 * i].add(X[i].mul(X[i]));
    } else {
      for (let j = 0; j < LIMB_NUM; j++) {
        delta[i + j] = delta[i + j].add(X[i].mul(Y[j]));
      }
    }

    for (let j = 0; j < LIMB_NUM; j++) {
      delta[i + j] = delta[i + j].sub(Q[i].mul(P[j]));
    }

    delta[i] = delta[i].sub(R[i]).seal();
  }

  // perform carrying on the difference to show that it is zero
  let carry = Field(0);

  for (let i = 0; i < 2 * LIMB_NUM - 2; i++) {
    let deltaPlusCarry = delta[i].add(carry).seal();

    carry = Provable.witness(Field, () =>
      deltaPlusCarry.div(1n << BigInt(LIMB_BITS))
    );
    rangeCheck128Signed(carry);

    // (xy - qp - r)_i + c_(i-1) === c_i * 2^116
    // proves that bits i*116 to (i+1)*116 of res are zero
    deltaPlusCarry.assertEquals(carry.mul(1n << BigInt(LIMB_BITS)));
  }

  // last carry is 0 ==> all of diff is 0 ==> x*y = q*p + r as integers
  delta[2 * LIMB_NUM - 2].add(carry).assertEquals(0n);

  return r;
}

/**
 * Custom range check for a single limb, x in [0, 2^116)
 */
function rangeCheck116(x: Field) {
  let [x0, x1] = Provable.witnessFields(2, () => [
    x.toBigInt() & ((1n << 64n) - 1n),
    x.toBigInt() >> 64n,
  ]);

  Gadgets.rangeCheck64(x0);
  let [x52] = Gadgets.rangeCheck64(x1);
  x52.assertEquals(0n); // => x1 is 52 bits
  // 64 + 52 = 116
  x0.add(x1.mul(1n << 64n)).assertEquals(x);
}

/**
 * Custom range check for carries, x in [-2^127, 2^127)
 */
function rangeCheck128Signed(xSigned: Field) {
  let x = xSigned.add(1n << 127n);

  let [x0, x1] = Provable.witnessFields(2, () => {
    const x0 = x.toBigInt() & ((1n << 64n) - 1n);
    const x1 = x.toBigInt() >> 64n;
    return [x0, x1];
  });

  Gadgets.rangeCheck64(x0);
  Gadgets.rangeCheck64(x1);

  x0.add(x1.mul(1n << 64n)).assertEquals(x);
}

// ----------------------------------------------------------------------------
