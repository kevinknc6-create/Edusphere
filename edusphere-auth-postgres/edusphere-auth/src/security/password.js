import argon2 from "argon2";

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations, 1 lane).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false; // malformed hash must never throw into the request
  }
}

export const needsRehash = (hash) => argon2.needsRehash(hash, OPTIONS);

/**
 * A real hash of a random value. Login verifies against it when the account doesn't exist,
 * so "unknown email" and "wrong password" take the same time (no account enumeration by timing).
 */
let dummy;
export async function dummyHash() {
  dummy ??= hashPassword(`dummy-${Math.random()}-${Date.now()}`);
  return dummy;
}
