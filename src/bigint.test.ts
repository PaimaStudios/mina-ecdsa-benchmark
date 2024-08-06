import { Big } from "./bigint.js";

test("two plus two", () => {
  expect(Big.from(2n).add(Big.from(2n)).toBigInt()).toBe(4n);
  expect(Big.from(2n).add(Big.from(-2n)).toBigInt()).toBe(0n);
  expect(Big.from(-2n).add(Big.from(2n)).toBigInt()).toBe(0n);
  expect(Big.from(-2n).add(Big.from(-2n)).toBigInt()).toBe(-4n);
});

test("two plus three", () => {
  expect(Big.from(2n).add(Big.from(3n)).toBigInt()).toBe(5n);
  expect(Big.from(3n).add(Big.from(2n)).toBigInt()).toBe(5n);
  expect(Big.from(3n).add(Big.from(-2n)).toBigInt()).toBe(1n);
  expect(Big.from(-2n).add(Big.from(3n)).toBigInt()).toBe(1n);
  expect(Big.from(2n).add(Big.from(-3n)).toBigInt()).toBe(-1n);
  expect(Big.from(-3n).add(Big.from(2n)).toBigInt()).toBe(-1n);
  expect(Big.from(-3n).add(Big.from(-2n)).toBigInt()).toBe(-5n);
  expect(Big.from(-2n).add(Big.from(-3n)).toBigInt()).toBe(-5n);
});

test("five squared", () => {
  expect(Big.from(5n).square().toBigInt()).toBe(25n);
  expect(Big.from(-5n).square().toBigInt()).toBe(25n);
});

test("floor div", () => {
  expect(Big.from(50n).floorDiv(Big.from(13n))).toEqual({
    quot: Big.from(3n),
    rem: Big.from(11n),
  });
});

test("gcd", () => {
  expect(Big.from(0n).gcd(Big.from(0n))).toEqual(Big.from(0n));
  expect(Big.from(0n).gcd(Big.from(7n))).toEqual(Big.from(7n));
  expect(Big.from(7n).gcd(Big.from(0n))).toEqual(Big.from(7n));

  expect(Big.from(10n).gcd(Big.from(4n))).toEqual(Big.from(2n));
  expect(Big.from(10n).gcd(Big.from(5n))).toEqual(Big.from(5n));
  expect(Big.from(207n).gcd(Big.from(36n))).toEqual(Big.from(9n));
});

test("gcdext", () => {
  expect(Big.from(240n).gcdext(Big.from(46n))).toEqual({
    g: Big.from(2n),
    s: Big.from(-9n),
  });
  expect(Big.from(207n).gcdext(Big.from(36n))).toEqual({
    g: Big.from(9n),
    s: Big.from(-1n),
  });
});
