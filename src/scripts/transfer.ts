import {
  AggregatorDelegate,
  HPLClient,
  bigIntReplacer,
  bigIntReviver,
} from "@research-ag/hpl-client";
import { TxArgs, TxHistoryEntry } from "../models/models";
import { Principal } from "@dfinity/principal";
import { catchError, lastValueFrom, map, of } from "rxjs";
import { pollForResponse } from "@dfinity/agent/lib/cjs/polling";
import { RequestId } from "@dfinity/agent";
import { maxAttempts } from "@dfinity/agent/lib/cjs/polling/strategy";
import { log } from "utils";
export const TX_HISTORY_KEY = "tx_history_";

export const runOrPickupSimpleTransfer = async (
  localId: string,
  txArgs: TxArgs,
  client: HPLClient,
  logCallback: (log: string) => void,
  loggers: {errors: (aggregator:string) => void},
  aggregatorPrincipal: string | Principal | null = null,
  submitRequestId: string | null = null,
  txId: [bigint, bigint] | null = null,
) => {
  let err = false;
  let aggregator: AggregatorDelegate | null = null;
    try {
      // pick aggregator
      log(["localId:",localId, "aggregator: ", aggregatorPrincipal?.toString() || "all", "Started"]);
      if (!aggregatorPrincipal) {
        onTxStatusChanged(
          localId,
          { txArgs, lastSeenStatus: "pickAggregator", aggregatorPrincipal: null },
          logCallback
        );
        aggregator = await client.pickAggregator();
      } else {
        aggregator = aggregatorPrincipal
          ? await client.createAggregatorDelegate(aggregatorPrincipal)
          : null;
      }
      

    } catch (error:any) {
      log(["pick aggregator error: ", aggregatorPrincipal?.toString() || "all", JSON.stringify(error)]);
    }

    if (!aggregator) {
      throw new Error("No available aggregator");
    }

    log(["localId:",localId, "aggregator: ", aggregatorPrincipal?.toString() || "all", "Submit request"]);
    try {
      // submit to aggregator
      if (!txId) {
        if (submitRequestId) {
          logCallback("Retrieving response by request id...");
          const requestId = new Uint8Array(
            submitRequestId!.split(",") as any as number[]
          ).buffer as RequestId;
          const responseBytes = await pollForResponse(
            (await aggregator.agent)!,
            aggregator.canisterPrincipal,
            requestId,
            maxAttempts(5)
          );
          txId = (
            await aggregator.parseResponse<[bigint, bigint][]>(
              "submitAndExecute",
              responseBytes,
              null
            )
          )[0];
        } else {
          const { requestId, commit } = await client.prepareSimpleTransfer(
            aggregator,
            ...txArgs
          );
          submitRequestId = new Uint8Array(requestId).join(",");
          onTxStatusChanged(
            localId,
            {
              txArgs,
              lastSeenStatus: "submitting",
              aggregatorPrincipal: aggregator.canisterPrincipal.toText(),
              submitRequestId,
            },
            logCallback,
            { aggregatorPrincipal: aggregator.canisterPrincipal.toText() },
            true
          );
          txId = await commit();
          onTxStatusChanged(
            localId,
            {
              txArgs,
              lastSeenStatus: "submitting",
              txId: txId!,
              aggregatorPrincipal: aggregator.canisterPrincipal.toText(),
              submitRequestId,
            },
            logCallback,
            { aggregatorPrincipal: aggregator.canisterPrincipal.toText() },
            true
          );
        }
      }
    } catch (error:any) {
      log(["submit to aggregator error: ", aggregatorPrincipal?.toString() || "all", JSON.stringify(error)]);
    }
    log(["localId:",localId,"TxId:",txId, "aggregator: ", aggregatorPrincipal?.toString() || "all", "Start poll tx"]);
    try {
    // poll tx
    await lastValueFrom(
      client.pollTx(aggregator, txId!).pipe(
        map((x) => {
          onTxStatusChanged(
            localId,
            {
              txArgs,
              aggregatorPrincipal: aggregator!.canisterPrincipal.toText(),
              txId: txId!,
              submitRequestId: submitRequestId!,
              lastSeenStatus: x.status,
            },
            logCallback,
            x.statusPayload
          );
        }),
        catchError(async (e: any) => {
          err = true;
          loggers.errors(aggregatorPrincipal?.toString() || "all");
          log(["localId:",localId,"TxId:",txId,"catch poll error: ", aggregatorPrincipal?.toString() || "all"]);
          await handleError(localId,  e, logCallback,txId!,);
          return of();
        })
      )
    );
  } catch (e: any) {
    err = true;
    loggers.errors(aggregatorPrincipal?.toString() || "all");
    log(["localId:",localId,"TxId:",txId,"try catch error: ", aggregatorPrincipal?.toString() || "all"]);
    await handleError(localId,  e, logCallback,txId!,);
  }

  return {txId, err}
};

async function onTxStatusChanged (
  localId: string,
  entry: TxHistoryEntry,
  logCallback: (log: string) => void,
  latestStatusPayload: any = null,
  printRequestId: boolean = false
) {
  
  global.transactions = [...global.transactions, JSON.stringify(entry, bigIntReplacer)];

  let consoleEntry = `TxId: ${entry.txId}; status: ${entry.lastSeenStatus}; payload: ${JSON.stringify(latestStatusPayload, bigIntReplacer)}`;

  if (printRequestId) {
    consoleEntry += `; submit request id: ${entry.submitRequestId}`;
  }

  log(["localId:",localId,"aggregator", entry.aggregatorPrincipal, "consoleEntry", consoleEntry]);

  logCallback(consoleEntry);
};


async function handleError (
  localId: string,
  e: any,
  logCallback: (log: string) => void,
  txId?: [bigint, bigint] | undefined,
) {
  const errorMessage = e.errorKey !== undefined ? `Error: ${e.toString()}` : "Error: " + e.message;
  console.log("errorMessage",JSON.stringify(errorMessage));

  log(["localId:",localId, "TxId:",txId, "errorMessage", JSON.stringify(errorMessage)]);

  logCallback("errorMessage");

  global.transactions = [...global.transactions, JSON.stringify({ errorMessage }, bigIntReplacer)];
};
