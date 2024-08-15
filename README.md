# Mina VDF primitive test

* 4096-bit big integer implementation in `src/bigint.ts`
    * `npm test -- bigint` to test
    * Tweak `GCD_ITERATIONS` up/down to test circuit sizes
    * Based on https://github.com/o1-labs/o1js/blob/main/src/examples/crypto/rsa/rsa.ts
    * Pietrzak and Weslowski are built to have a good security level at 2048-bit numbers
    * Sometimes we multiply them and have 4096-bit intermediaries
    * `Provable.witness` used to implement integer division
    * Doesn't seem feasible to use same strategy for GCD
* ClassGroup integer implementation in `src/classgroup.ts`
    * `npm test -- classgroup` to test
    * Based on https://github.com/poanetwork/vdf/
    * Tweak `REDUCE_ITERATIONS` up/down to test circuit sizes
* ZkProgram test in `src/zkp.test.ts`
    * `npm test -- zkp` to test
    * Will take forever then run out of memory, presumably due to circuit size
