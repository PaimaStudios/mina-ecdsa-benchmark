import { Bool, Field, Provable, Struct } from "o1js";
import { Big } from "./bigint.js";

const REDUCE_ITERATIONS = 250;

export class ClassGroup extends Struct({
  a: Big,
  b: Big,
  c: Big,
  discriminant: Big,
}) {
  static from_ab_discriminant(a: Big, b: Big, discriminant: Big): ClassGroup {
    let four_a = a.mul(Big.from(4n));
    let c = b.square().sub(discriminant).floorDiv(four_a).quot;
    return new ClassGroup({
      a,
      b,
      c,
      discriminant: discriminant,
    });
  }

  identity(): ClassGroup {
    return ClassGroup.from_ab_discriminant(
      Big.from(1n),
      Big.from(1n),
      this.discriminant
    );
  }

  mul(rhs: ClassGroup): ClassGroup {
    this.assertValid();
    rhs.assertValid();

    // g = (b1 + b2) / 2
    const g = this.b.add(rhs.b).floorDiv(Big.from(2n)).quot;
    // h = (b2 - b1) / 2
    const h = rhs.b.sub(this.b).floorDiv(Big.from(2n)).quot;

    // sanity check
    h.add(g).assertEquals(rhs.b);
    g.sub(h).assertEquals(this.b);

    // w = gcd(a1, a2, g)
    const w = this.a.gcd(rhs.a).gcd(g);
    // j = w
    const j = w;
    // s = a1/w
    const s = this.a.floorDiv(w).quot;
    // t = a2/w
    const t = rhs.a.floorDiv(w).quot;
    // u = g/w
    const u = g.floorDiv(w).quot;
    // a = t*u
    let a = t.mul(u);
    // b = h*u - s*c1
    let b = h.mul(u)./*sub*/add(s.mul(this.c));
    // m = s*t
    let m = s.mul(t);
    const { x: mu, v } = Big.solveLinearCongruence(a, b, m);
    // a = t*v
    a = t.mul(v);
    // b = h - t * mu
    b = h.sub(t.mul(mu));
    // m = s
    const { x: lambda, v: sigma } = Big.solveLinearCongruence(a, b, s);
    // k = mu + v*lambda
    const k = mu.add(v.mul(lambda));
    // l = (k*t - h)/s
    const l = k.mul(t).sub(h).floorDiv(s).quot;
    // m = (t*u*k - h*u - c*s) / s*t
    m = t
      .mul(u)
      .mul(k)
      .sub(h.mul(u))
      .sub(this.c.mul(s))
      .floorDiv(s.mul(t)).quot;
    // A = s*t - r*u
    a = s.mul(t) /*.sub(r.mul(u))*/;
    // B = ju + mr - (kt + ls)
    b = j
      .mul(u) /*.add(m.mul(r))*/
      .sub(k.mul(t))
      .sub(l.mul(s));
    // C = kl - jm
    const c = k.mul(l).sub(j.mul(m));

    return new ClassGroup({
      a,
      b,
      c,
      discriminant: this.discriminant,
    }).reduce();
  }

  normalize(): ClassGroup {
    this.assertValid();

    let negative_a = this.a.neg();
    let alreadyNormal = this.b.greaterThan(negative_a).and(this.b.lessThanOrEqual(this.a));

    let r = this.a.sub(this.b);
    const denom = this.a.mul(Big.from(2n));
    negative_a = r.floorDiv(denom).quot;
    [negative_a, r] = [r, negative_a];
    let ra = r.mul(this.a);
    negative_a = ra.mul(Big.from(2n));
    let b = this.b.add(negative_a);

    negative_a = ra.mul(r);
    let old_a = this.c.add(negative_a);

    ra = r.mul(this.b);
    let c = old_a.add(ra);

    const result = new ClassGroup({
      a: this.a,
      b,
      c,
      discriminant: this.discriminant,
    })
    result.assertValid();
    return new ClassGroup(Provable.if(alreadyNormal, ClassGroup, this, result));
  }

  reduce(): ClassGroup {
    let result = this.normalize();

    let solved = Bool(false);
    let { a, b, c, discriminant } = result;
    for (let i = 0; i < REDUCE_ITERATIONS; ++i) {
      const shouldContinue = Provable.if(b.negative, Bool, a.greaterThanOrEqual(c), a.greaterThan(c));
      const newlySolved = solved.not().and(shouldContinue.not());
      solved = solved.or(newlySolved);
      result = new ClassGroup(Provable.if(newlySolved, ClassGroup, { a, b, c, discriminant }, result))

      let s = c.add(b);
      let x = c.add(c);

      let old_b = b;
      b = s.mul(x);

      [s, b] = [b, s];
      [a, c] = [c, a];

      // x = 2sc
      b = s.mul(a);
      x = x.mul(b).mul(Big.from(2n));

      // b = x - old_b
      b = x.sub(old_b);

      // x = b*s
      x = old_b.mul(s);

      // s = c*s^2
      old_b = s.mul(s);
      s = a.mul(old_b);

      // c = s - x
      c = s.sub(x);
    }
    solved.assertTrue(`${REDUCE_ITERATIONS} iterations insufficient for reduce(${this})`);

    return result.normalize();
  }

  pow(exponent: Big) {
    const bits = exponent.toBits();
    let result = this.identity();
    let squares: ClassGroup = this;
    for (let i = 0; i < bits.length; ++i) {
      result = new ClassGroup(
        Provable.if(bits[i], ClassGroup, result.mul(squares), result)
      );
      squares = squares.mul(squares);
    }
    return result;
  }

  assertValid() {
    this.discriminant
      .add(Big.from(4n).mul(this.a).mul(this.c))
      .assertEquals(this.b.square());
  }

  assertEquals(other: ClassGroup) {
    this.a.assertEquals(other.a);
    this.b.assertEquals(other.b);
    this.c.assertEquals(other.c);
    this.discriminant.assertEquals(other.discriminant);
  }
}
