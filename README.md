# Mina ECDSA benchmark

* Build, start Lightnet node, and run: `npm start`
* Stop Lightnet node: `docker compose down`

A benchmark to compare the speed of two approaches to EVM->Mina delegation, each based on Mina's ECDSA foreign curve support.

In common:

* An EVM wallet signs just one message up front, the "delegation order", which contains the Mina address it authorizes to represent it in future zkApp calls.
* Mina's ECDSA support is used to prove this signature in a ZK circuit.
* This proof is eventually provided to a 'user' zkApp smart contract that checks that (a) the previous proof is valid and (b) the Mina address in the order matches the sender of the zkApp transaction.

Differences:

We propose two options:
1. `merkle` delegation info is stored onchain as a `MerkleMap` in a ZkApp for other ZkApps to query (recall: function calls to other ZkApps works similar to `ZkProgram` under the hood)
2. `program` where delegation is inlined as a `ZkProgram` manually and no persistant mapping is stored

# Benchmark

There are 2 steps:
1. `Setup`: only needs to be performed once

| Type    | Step   | Time   | Note                                                                                                     |
|---------|--------|--------|----------------------------------------------------------------------------------------------------------|
| Program | Setup  | \~60s    | Can be cached in localstorage for re-use later                                                           |
| Merkle  | Setup  | 50\~60s | Result stored onchain. Not including network overhead to fetch the Merkle map state from the network in order to construct the proof |

2. `Verify`: needs to be performed every time

| Type    | Step   | Time   | Note                                                                                                     |
|---------|--------|--------|----------------------------------------------------------------------------------------------------------|
| Program | Verify | \~2s    |                                                                                                          |
| Merkle  | Verify | 10\~15s | Not including network overhead to fetch the Merkle map state from the network in order to construct the proof |
