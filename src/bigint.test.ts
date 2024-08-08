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

test("floorDiv", () => {
  expect(Big.from(50n).floorDiv(Big.from(13n))).toEqual({
    quot: Big.from(3n),
    rem: Big.from(11n),
  });

  expect(Big.from(-50n).floorDiv(Big.from(13n))).toEqual({
    quot: Big.from(-4n),
    rem: Big.from(2n),
  });

  expect(Big.from(50n).floorDiv(Big.from(-13n))).toEqual({
    quot: Big.from(-4n),
    rem: Big.from(-2n),
  });

  expect(Big.from(-50n).floorDiv(Big.from(-13n))).toEqual({
    quot: Big.from(3n),
    rem: Big.from(-11n),
  });
});

test("truncDiv", () => {
  expect(Big.from(50n).truncDiv(Big.from(13n))).toEqual({
    quot: Big.from(3n),
    rem: Big.from(11n),
  });

  expect(Big.from(-50n).truncDiv(Big.from(13n))).toEqual({
    quot: Big.from(-3n),
    rem: Big.from(-11n),
  });

  expect(Big.from(50n).truncDiv(Big.from(-13n))).toEqual({
    quot: Big.from(-3n),
    rem: Big.from(11n),
  });

  expect(Big.from(-50n).truncDiv(Big.from(-13n))).toEqual({
    quot: Big.from(3n),
    rem: Big.from(-11n),
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
  expect(Big.from(240n).gcdExt(Big.from(46n))).toEqual({
    g: Big.from(2n),
    s: Big.from(-9n),
  });
  expect(Big.from(207n).gcdExt(Big.from(36n))).toEqual({
    g: Big.from(9n),
    s: Big.from(-1n),
  });
  expect(Big.from(-12n).gcdExt(Big.from(16n))).toEqual({
    // 4 = gcd(-12, 16)
    // 1 * -12 + 1 * 16 = 4
    g: Big.from(4n),
    s: Big.from(1n),
  });
});

function checkLinearCongruence(
  a: bigint,
  b: bigint,
  m: bigint,
  mu: bigint,
  v: bigint
) {
  expect(
    Big.solveLinearCongruence(Big.from(a), Big.from(b), Big.from(m))
  ).toEqual({ x: Big.from(mu), v: Big.from(v) });
}

test("solveLinearCongruence", () => {
  checkLinearCongruence(4n, -2n, 2n, 0n, 1n);

  checkLinearCongruence(
    2n,
    6057015141127869337403334869908729987552397110174064450792864141313390824995799650859030332705562667108004346355706456038522602963351763045080793916145017423985449587737424220415893337201949898068499641962016077254409197853157449632859306048669680666510472208607811218832321823311619380958358418308906813483061527877480874825416069992527365746028166324320056223838124450238872327099743103802660733366011317367925345039383436903790749831123334365069647487969238939997395681255379735289330605270894876228333824537335458712656230388152436462359364513321550541483305896473074831697809385924699958587895848081008638653346n,
    4n,
    1n,
    2n
  );

  checkLinearCongruence(
    -12n,
    6057015141127869337403334869908729987552397110174064450792864141313390824995799650859030332705562667108004346355706456038522602963351763045080793916145017423985449587737424220415893337201949898068499641962016077254409197853157449632859306048669680666510472208607811218832321823311619380958358418308906813483061527877480874825416069992527365746028166324320056223838124450238872327099743103802660733366011317367925345039383436903790749831123334365069647487969238939997395681255379735289330605270894876228333824537335458712656230388152436462359364513321550541483305896473074831697809385924699958587895848081008638653348n,
    16n,
    9n,
    4n
  );

  checkLinearCongruence(
    29952n,
    6057015141127869337403334869908729987552397110174064450792864141313390824995799650859030332705562667108004346355706456038522602963351763045080793916145017423985449587737424220415893337201949898068499641962016077254409197853157449632859306048669680666510472208607811218832321823311619380958358418308906813483061527877480874825416069992527365746028166324320056223838124450238872327099743103802660733366011317367925345039383436903790749831123334365069647487969238939997395681255379735289330605270894876228333824537335458712656230388152436462359364513321550541483305896473074831697809385924699958587895848081008638656768n,
    65536n,
    -8355n,
    256n
  );
});
