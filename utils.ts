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

// Append request's logs to the log's file
export async function  log(requestLog: any[]) {
  const LOG_PATH = `logs/${getDate()}.log`;
  try {
      // console.log((new Date()).toISOString() +" "+requestLog.join(' '));
      let logs = await Bun.file(LOG_PATH).text();
      // Write (file's content + request's log) 
      logs = logs + '\n'
      await Bun.write(LOG_PATH, logs.concat((new Date()).toISOString() +" "+ requestLog.join(' ')));
  } catch (e) {
      // If log's file doesn't exist, write new content
      await Bun.write(LOG_PATH, ''.concat((new Date()).toISOString() +" "+ requestLog.join(' ')));
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