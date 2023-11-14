import { Identity } from "@dfinity/agent";
import { FeeMode, HPLClient, SimpleTransferStatusKey, TransferAccountReference } from "@research-ag/hpl-client";

export type Wallet =  Identity | null;
export type DuplaClients = [HPLClient, HPLClient];
export type TxArgs = [from: TransferAccountReference, to: TransferAccountReference, asset: bigint, amount: number | BigInt | 'max', feeMode?: FeeMode, memo?: Array<Uint8Array | number[]>];
export type TxHistoryEntry = {
    txArgs: TxArgs;
    lastSeenStatus: SimpleTransferStatusKey | 'pickAggregator' | 'submitting' | null;
    aggregatorPrincipal: string | null;
    txId?: [bigint, bigint];
    submitRequestId?: string;
    errorMessage?: string;
  };


  