import { Ed25519KeyIdentity } from '@dfinity/identity';
import { Wallet } from './src/models/models';
import { appendFile } from "node:fs/promises";

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

// Append request's logs to the log's file
export function log(requestLog: any[]) {
  const LOG_PATH = `logs/${getDate()}.log`;
  try {
      // Write (file's content + request's log) 
      appendFile(LOG_PATH, `\n ${(new Date()).toISOString() +" "+ requestLog.join(' ')}`);
  } catch (e) {
      // If log's file doesn't exist, write new content
      console.log("Log file doesn't exist",e);
  }
}

function getDate(){
  let objectDate = new Date();
  let day = objectDate.getDate();
  let month = objectDate.getMonth();
  let year = objectDate.getFullYear();
  let format1 = month + "-" + day + "-" + year;
  return format1;
}

export function randomId(length = 6) {
  return Math.random().toString(36).substring(2, length+2);
};

export function randomNumber() {
  return Math.random();
};