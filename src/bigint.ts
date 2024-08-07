// ----------------------------------------------------------------------------
import { Bool, Field, Gadgets, Provable, Struct } from "o1js";

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
  negative: Bool,
  // Little-endian: [0] is least significant, [LIMB_NUM-1] is most
  fields: Limbs,
}) {
  // --------------------------------------------------------------------------
  // Get in & out of provable world

  static from(x: bigint) {
    const negative = x < 0n;
    if (negative) {
      x = -x;
    }

    let fields = [];
    for (let i = 0; i < LIMB_NUM; i++) {
      fields.push(Field(x & MASK));
      x >>= BigInt(LIMB_BITS);
    }
    if (x !== 0n) throw new Error("leftover: " + x);
    return new Big({
      negative: Bool(negative),
      fields,
    });
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
    let value = 0n;
    for (let i = LIMB_NUM - 1; i >= 0; i--) {
      value <<= BigInt(LIMB_BITS);
      value += this.fields[i].toBigInt();
    }
    if (this.negative.toBoolean()) {
      value = -value;
    }
    return value;
  }

  toString(): string {
    return `${this.toBigInt() == 0n && this.negative.toBoolean() ? "-" : ""}${this.toBigInt()}`;
  }

  toJSON(): string {
    return this.toString();
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

  abs(): Big {
    return new Big({
      negative: Bool(false),
      fields: this.fields,
    });
  }

  neg(): Big {
    return new Big({
      negative: this.negative.not(),
      fields: this.fields,
    });
  }

  add(rhs: Big): Big {
    // same sign:
    //   X + y = x + y
    //   -x + -y = -(x + y)
    // different sign:
    //   Big - Small = +
    //   Small - Big = -
    //   -Big + Small = -
    //   -Small + Big = +
    const isSub = this.negative.equals(rhs.negative).not();
    const thisSmall = this.abs().lessThan(rhs.abs());
    const resultNegative = Provable.if(
      isSub,
      Bool,
      rhs.negative.equals(thisSmall),
      this.negative
    );

    const addFields = Limbs.empty();
    let carry = Bool(false);

    for (let i = 0; i < LIMB_NUM; i++) {
      addFields[i] = this.fields[i].add(rhs.fields[i]).add(carry.toField());
      carry = addFields[i].greaterThan(MASK);
      addFields[i] = Provable.if(
        carry,
        Field,
        addFields[i].sub(MODULUS),
        addFields[i]
      );
    }
    carry.assertFalse();

    const [bigger, smaller] = Provable.if(
      thisSmall,
      Provable.Array(Big, 2),
      [rhs, this],
      [this, rhs]
    );
    const subFields = Limbs.empty();
    carry = Bool(false);
    for (let i = 0; i < LIMB_NUM; i++) {
      subFields[i] = bigger.fields[i]
        .sub(smaller.fields[i])
        .sub(carry.toField());
      carry = subFields[i].greaterThan(MASK);
      subFields[i] = Provable.if(
        carry,
        Field,
        subFields[i].add(MODULUS),
        subFields[i]
      );
    }
    carry.assertFalse();

    return new Big({
      negative: resultNegative,
      fields: Provable.if(isSub, Limbs, subFields, addFields),
    });
  }

  sub(y: Big): Big {
    return this.add(y.neg());
  }

  mul(y: Big): Big {
    return new Big({
      negative: this.negative.equals(y.negative).not(),
      fields: Big.MAX.modMul(this.abs(), y.abs()).fields,
    });
  }

  square(): Big {
    return Big.MAX.modSquare(this.abs());
  }

  floorDiv(y: Big): { quot: Big; rem: Big } {
    // this = q * y + r
    const { q, r } = Provable.witness(Struct({ q: Big, r: Big }), () => {
      let lhs = this.toBigInt(),
        rhs = y.toBigInt(),
        q = lhs / rhs,
        r = lhs % rhs;
      return { q: Big.from(q), r: Big.from(r) };
    });

    //console.log(this.toBigInt(), '==', y.toBigInt(), '*', q.toBigInt(), '+', r.toBigInt());

    // TODO q.assertLessThanOrEqual(this);
    r.assertLessThan(y);
    // TODO r.assertLessThanOrEqual(this);
    y.mul(q).add(r).assertEquals(this);
    return { quot: q, rem: r };
  }

  divExact(y: Big): Big {
    // this = q * y
    const q = Provable.witness(Big, () => {
      return Big.from(this.toBigInt() / y.toBigInt());
    });
    y.mul(q).assertEquals(this);
    return q;
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
    // result is always positive, unless this==b==0, then result is 0
    let a: Big = this.abs();
    b = b.abs();

    let g = Big.ZERO;
    let solved = Bool(false);

    let g_0 = this.abs();
    let g_1 = b.abs();
    for (let i = 0; i < 40; ++i) {
      const isZero = g_1.equals(Big.ZERO);
      const newlySolved = solved.not().and(isZero);
      solved = solved.or(newlySolved);
      g = new Big(Provable.if(newlySolved, Big, g_0, g));

      // a %= b
      const { rem } = g_0.floorDiv(
        new Big(Provable.if(isZero, Big, Big.ONE, g_1))
      );
      g_0 = g_1;
      g_1 = rem;
    }
    solved.assertTrue();

    return g;
  }

  gcdExt(b: Big): { g: Big; s: Big } {
    // result is always positive, unless this==b==0, then result is 0
    let a: Big = this.abs();
    b = b.abs();

    let g = Big.ZERO;
    let s = Big.ZERO;
    let solved = Bool(false);

    let g_0 = this.abs();
    let g_1 = b.abs();
    let s_0 = Big.ONE;
    let s_1 = Big.ZERO;
    for (let i = 0; i < 40; ++i) {
      const isZero = g_1.equals(Big.ZERO);
      const newlySolved = solved.not().and(isZero);
      solved = solved.or(newlySolved);

      g = new Big(Provable.if(newlySolved, Big, g_0, g));
      s = new Big(Provable.if(newlySolved, Big, s_0, s));

      // a %= b
      const { quot, rem } = g_0.floorDiv(
        new Big(Provable.if(isZero, Big, Big.ONE, g_1))
      );
      g_0 = g_1;
      g_1 = rem;

      const s_2 = s_0.sub(quot.mul(s_1));
      s_0 = s_1;
      s_1 = s_2;
    }
    solved.assertTrue();

    return { g, s };
  }

  // Solves `a*x = b (mod m)`.
  static solveLinearCongruence(
    a: Big,
    b: Big,
    m: Big
  ): {
    x: Big;
    v: Big;
  } {
    const { g, s: d } = a.gcdExt(m);
    const q = b.divExact(g);
    const r = q.mul(d);
    const x = r.floorDiv(m).rem;
    const v = m.divExact(g);
    return { x, v };
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
    // Handle absolute value
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
    // Handle sign
    const thisNegative = this.negative.and(this.isZero().not());
    const otherNegative = other.negative.and(other.isZero().not());
    return Provable.switch(
      [
        thisNegative.and(otherNegative.not()),
        thisNegative.not().and(otherNegative),
        thisNegative.not().and(otherNegative.not()),
        thisNegative.and(otherNegative),
      ],
      Field,
      [
        Field(Ordering.Less), // - < +
        Field(Ordering.Greater), // + > -
        // + v + is normal
        state,
        // - v - is flipped
        Provable.switch(
          [
            state.equals(Ordering.Less),
            state.equals(Ordering.Equal),
            state.equals(Ordering.Greater),
          ],
          Field,
          [Field(Ordering.Greater), Field(Ordering.Equal), Field(Ordering.Less)]
        ),
      ]
    );
  }

  isZero(): Bool {
    let state = Bool(true);
    for (let i = 0; i < LIMB_NUM; ++i) {
      state = state.and(this.fields[i].equals(0));
    }
    return state;
  }

  equals(other: Big): Bool {
    // Simpler than cmp()
    let bothAreZero = Bool(true);
    let allEqual = Bool(this.negative.equals(other.negative));
    for (let i = 0; i < LIMB_NUM; ++i) {
      allEqual = allEqual.and(this.fields[i].equals(other.fields[i]));
      bothAreZero = bothAreZero.and(this.fields[i].equals(0));
      bothAreZero = bothAreZero.and(other.fields[i].equals(0));
    }
    return bothAreZero.or(allEqual);
  }

  lessThan(other: Big): Bool {
    return this.cmp(other).equals(Ordering.Less);
  }

  lessThanOrEqual(other: Big): Bool {
    return this.cmp(other).equals(Ordering.Greater).not();
  }

  greaterThan(other: Big): Bool {
    return this.cmp(other).equals(Ordering.Greater);
  }

  greaterThanOrEqual(other: Big): Bool {
    return this.cmp(other).equals(Ordering.Less).not();
  }

  assertEquals(other: Big): void {
    const message = `expected ${this} == ${other}`;
    let bothAreZero = Bool(true);
    for (let i = 0; i < LIMB_NUM; ++i) {
      this.fields[i].assertEquals(other.fields[i], message);
      bothAreZero = bothAreZero.and(this.fields[i].equals(0));
      bothAreZero = bothAreZero.and(other.fields[i].equals(0));
    }
    this.negative.equals(other.negative).or(bothAreZero).assertTrue(message);
  }

  assertLessThan(other: Big): void {
    this.cmp(other).assertEquals(Ordering.Less, `expected ${this} < ${other}`);
  }

  assertLessThanOrEqual(other: Big): void {
    this.cmp(other).assertNotEquals(
      Ordering.Greater,
      `expected ${this} <= ${other}`
    );
  }

  assertGreaterThan(other: Big): void {
    this.cmp(other).assertEquals(
      Ordering.Greater,
      `expected ${this} > ${other}`
    );
  }

  assertGreaterThanOrEqual(other: Big): void {
    this.cmp(other).assertNotEquals(
      Ordering.Less,
      `expected ${this} >= ${other}`
    );
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
