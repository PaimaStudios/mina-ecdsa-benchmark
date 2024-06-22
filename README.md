# Mina ECDSA benchmark

* Build, start Lightnet node, and run: `npm start`
* Stop Lightnet node: `docker compose down`

A benchmark to compare the speed of two approaches to EVM->Mina delegation, each based on Mina's ECDSA foreign curve support.

In common:

* An EVM wallet signs just one message up front, the "delegation order", which contains the Mina address it authorizes to represent it in future zkApp calls.
* Mina's ECDSA support is used to prove this signature in a ZK circuit.
* This proof is eventually provided to a 'user' zkApp smart contract that checks that (a) the previous proof is valid and (b) the Mina address in the order matches the sender of the zkApp transaction.

Differences:

1. `program`: A ZkProgram is used to represent the proof of the ECDSA signature verification, and the proof of that program is passed to the zkApp contracts as a recursive proof. This approach is simplest but the ECDSA circuit is recursively verified every time (the recursive proof can be cached).
2. `merkle`: A zkApp uses an o1js `MerkleMap` (Merkle tree of depth 256) to remember the set of all delegation orders that have been verified. Inserts to this map check the ECDSA signature of the submitted order. The 'user' zkApp then accepts a `MerkleWitness` instead of a recursive proof and makes a contract-to-contract call to query whether that witness describes a delegation order whose signature was previously verified. This approach requires the delegation contract's full history to be pulled from an archive node before being able to make inserts or queries, but allows the delegation state to be easily queried from other contracts without having to embed the ZkProgram inside their code.

# Benchmark

1. `program`
    1. Setup: it takes around ~60s to cache the ZK proof. This proof can be cached in localstorage to reuse later
    2. Verify: It only takes ~2s to verify this proof in a ZkApp going forward (if you ignore general zkApp overhead). 
2. `merkle`. Note: for every step here, network calls are required to fetch the merkle tree state from the network
    1. Setup: it takes around 50~60s to generate the ZK proof of insertion into the MerkleMap (only need to do this once), plus network overhead
    2. Verify: it takes takes 10~15s to query the map state from other contracts, plus network overhead
