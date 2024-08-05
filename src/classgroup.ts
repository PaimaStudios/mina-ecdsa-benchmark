import { Provable, Struct } from "o1js";
import { Big } from "./bigint.js";

export class ClassGroup extends Struct({
  a: Big,
  b: Big,
  c: Big,
  abs_discriminant: Big,
}) {
  static from_ab_discriminant(
    a: Big,
    b: Big,
    abs_discriminant: Big
  ): ClassGroup {
    let four_a = a.mul(Big.from(4n));
    let c = b.square().add(abs_discriminant).floorDiv(four_a).q;
    return new ClassGroup({
      a,
      b,
      c,
      abs_discriminant,
    });
  }

  identity(): ClassGroup {
    return ClassGroup.from_ab_discriminant(
      Big.from(1n),
      Big.from(1n),
      this.abs_discriminant
    );
  }

  mul(rhs: ClassGroup): ClassGroup {
    throw new Error("TODO");
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

  assertEquals(other: ClassGroup) {
    this.a.assertEquals(other.a);
    this.b.assertEquals(other.b);
    this.c.assertEquals(other.c);
    this.abs_discriminant.assertEquals(other.abs_discriminant);
  }
}
