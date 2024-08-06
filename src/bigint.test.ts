import { Big } from "./bigint";

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
