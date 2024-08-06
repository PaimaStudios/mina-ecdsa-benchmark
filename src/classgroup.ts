import { Bool, Field, Provable, Struct } from "o1js";
import { Big } from "./bigint.js";

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
    console.log("g=", g.toBigInt());
    console.log("h=", h.toBigInt());
    // w = gcd(a1, a2, g)
    const w = this.a.gcd(rhs.a).gcd(g);
    console.log("w=", w.toBigInt());
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
    console.log("s=", s.toBigInt());
    console.log("c=", this.c.toBigInt());
    let b = h.mul(u).sub(s.mul(this.c));
    // m = s*t
    let m = s.mul(t);
    const { x: mu, v } = Big.solveLinearCongruence(a, b, m);
    // a = t*v
    a = t.mul(v);
    // b = h - t * mu
    b = h.sub(t.mul(mu));
    // m = s
    const { x: lambda, v: sigma } = Big.solveLinearCongruence(a, b, m);
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
    });
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
