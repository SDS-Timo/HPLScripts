import { Ed25519KeyIdentity } from '@dfinity/identity';
import { Wallet } from './src/models/models';

export const wrapCall = <Args extends Array<unknown>>(f: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> => {
    return async (...args) => {
      try {
        await f(...args);
      } catch (err) {
        console.error(err);
      }
    };
  };

export function seedToIdentity(seed: string): Wallet {
    const seedBuf = new Uint8Array(new ArrayBuffer(32));
    if (seed.length && seed.length > 0 && seed.length <= 32) {
      seedBuf.set(new TextEncoder().encode(seed));
      return Ed25519KeyIdentity.generate(seedBuf);
    }
    return null;
};