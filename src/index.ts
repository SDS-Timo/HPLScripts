import { HPLClient, TransferAccountReference } from "@research-ag/hpl-client";
import { log, seedToIdentity } from "../utils";
import { Wallet } from "./models/models";
import { runOrPickupSimpleTransfer } from "./scripts/transfer";
import Prometheus from "prom-client";
import { Elysia } from "elysia";
import { cron } from "@elysiajs/cron";
import { Principal } from "@dfinity/principal";
import { _SERVICE as LedgerActor } from "@research-ag/hpl-client/dist/candid/ledger";
import { idlFactory as LedgerIDLFactory } from "@research-ag/hpl-client/dist/candid/ledger.idl";
import { _SERVICE as AggActor } from "@research-ag/hpl-client/dist/candid/aggregator";
import { idlFactory as AggIDLFactory } from "@research-ag/hpl-client/dist/candid/aggregator.idl";
import { Actor, HttpAgent, Identity } from "@dfinity/agent";

const port = process.env.PORT || 3000;
const ledger_principal = process.env.LEDGER_PRINCIPAL || "";
const interval_time = process.env.INTERVAL_TIME || "*/10 * * * * *";
const script_mode = process.env.SCRIPT_MODE || "ALL";
const AGENT_HOST = process.env.AGENT_HOST || "https://icp0.io";

/// ============== PROMETHEUS ==============
const register = new Prometheus.Registry();

function getData() {
  if (script_mode === "FUNCTIONAL")
    return {
      data:{
        histogram: {
          name: "tracked_time_function", 
          buckets: Prometheus.linearBuckets(0, 1000, 25)
        },
        error_counter: "tracked_errors_function",
        requested_counter: "tracked_requests_function",
        labels: ["function"],
      }
    };
  if(script_mode === "PING")
    return {
      data:{
        histogram: {
          name: "ping_time_tracked", 
          buckets: Prometheus.linearBuckets(0, 1000, 25)
        },
        histogram_response: {
          name: "ping_time_response", 
          buckets: Prometheus.linearBuckets(0, 1000, 25)
        },
        histogram_call: {
          name: "ping_time_call", 
          buckets: Prometheus.linearBuckets(0, 1000, 25)
        },
        error_counter: "tracked_errors_time",
        requested_counter: "tracked_requests_time",
        labels: ["canister"],
      }
    };
  return {
    data: {
      histogram: {
        name: "transfer_time",
        buckets: Prometheus.linearBuckets(0, 1000, 50)
      },
      error_counter: "transfer_errors",
      requested_counter: "transfer_requests",
      labels: ["aggregator"],
    }
  };
}

const transfers_time = new Prometheus.Histogram({
  name: getData().data.histogram.name,
  help: "Count of time took to process",
  labelNames: getData().data.labels,
  buckets: getData().data.histogram.buckets,
});
register.registerMetric(transfers_time);

const time_response = new Prometheus.Histogram({
  name: getData().data.histogram_response?.name || "ping_time_response",
  help: "Count of time took to process",
  labelNames: getData().data.labels,
  buckets: getData().data.histogram_response?.buckets || [],
});
register.registerMetric(time_response);

const time_call = new Prometheus.Histogram({
  name: getData().data.histogram_call?.name || "ping_time_call",
  help: "Count of time took to process",
  labelNames: getData().data.labels,
  buckets: getData().data.histogram_call?.buckets  || [],
});
register.registerMetric(time_call);

const error_counter = new Prometheus.Counter({
  name: getData().data.error_counter,
  help: "Count of errors on process",
  labelNames: getData().data.labels,
});
register.registerMetric(error_counter);

const requested_counter = new Prometheus.Counter({
  name: getData().data.requested_counter,
  help: "Count of requests on process",
  labelNames: getData().data.labels,
});
register.registerMetric(requested_counter);

register.setDefaultLabels({
  app: "hpl-script",
});

/// ============== CRON THAT ACTIVATES PROCESS ==============
new Elysia()
  .use(
    cron({
      name: "execute-transfer",
      pattern: interval_time,
      run() {
        if (script_mode === "ALL") StartProcess();
        if (script_mode === "AGGREGATOR") StartProcessPerAggregator();
        if (script_mode === "FUNCTIONAL") StartProcessFunction();
        if (script_mode === "PING") StartProcessPing();
      },
    })
  )
  .listen(8080);

/// ============== BUN SERVER ==============
const server = Bun.serve({
  port: port,
  fetch(request) {
    return controller(request);
  },
});

console.log(`Listening on localhost: ${server.port}`);

// Controller to show metrics
async function Metrics(request: Request): Promise<Response> {
  const data = await register.metrics();
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": register.contentType,
    },
  });
}

// General controller
async function controller(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === "/")
    return new Response("Welcome to Bun!");
  else if (new URL(request.url).pathname === "/metrics")
    return await Metrics(request);
  else return new Response("Not found", { status: 404 });
}

// =============== Process Funtions ==============
// CreateSeeds
function CreateSeedPrincipals(): Wallet {
  return seedToIdentity(Bun.env.PRINCIPAL1_SECRET_KEY || "") satisfies Identity | null;
}

// StartProcess
async function StartProcess() {
  const wallet = CreateSeedPrincipals();
  const client = startClients(wallet);

  if (!global.transactions) global.transactions = [];
  const promises = [
    new Promise(async (resolve, reject) => {
      requested("all");

      const start = Date.now();
      await MakeTransfer(client);
      const seconds = Date.now() - start;

      try {
        transfers_time.labels({ aggregator: "all" }).observe(seconds);
      } catch (error) {
        console.log("error", error);
        reject(error);
      }

      global.transactions = [];
      resolve(true);
    }),
  ];
  Promise.all(promises);
}

//Agregators
async function StartProcessPerAggregator() {
  const wallet = CreateSeedPrincipals();
  const client = startClients(wallet);
  const aggregators = await client.getAggregators();
  const promises = [];

  if (!global.transactions) global.transactions = [];
  for (const aggregator of aggregators) {
    const promise = new Promise(async (resolve, reject) => {
      const aggPrincipal = aggregator.canisterPrincipal.toText();
      requested(aggPrincipal);

      const start = Date.now();
      await MakeTransfer(client, aggregator.canisterPrincipal); 
      const seconds = Date.now() - start;
      
      try {
        log(["aggregator:",aggPrincipal, "seconds:", seconds]);
        transfers_time.labels({ aggregator: aggPrincipal }).observe(seconds);
      } catch (error) {
        log(["error", error]);
        reject(error);
      }

      global.transactions = [];
      resolve(true);
    });
    promises.push(promise);
  }

  Promise.all(promises);
}

//Specific function
async function StartProcessFunction() {
  const wallet = CreateSeedPrincipals();
  const client = startClients(wallet);

  if (!global.transactions) global.transactions = [];
  // if (wallet) {
    const promises = [
      new Promise(async (resolve, reject) => {
        //requested counter
        requested_counter.labels({ function: "updateVirtualAccount" }).inc();

        // start timer
        const start = Date.now();

        // update virtual account
        await updateVirtualAccount(wallet!)
          .then((a) => console.log("result", a))
          .catch((error) => {
            console.log("error", error);
            error_counter.labels({ function: "updateVirtualAccount" }).inc();
          });
        // end timer
        const seconds = Date.now() - start;

        // register time
        try {
          transfers_time
            .labels({ function: "updateVirtualAccount" })
            .observe(seconds);
        } catch (error) {
          console.log("error", error);
          reject(error);
        }

        global.transactions = [];
        resolve(true);
      }),
    ];

    Promise.all(promises);
  // }
}

function updateVirtualAccount(wallet?: Identity) {
  const myAgent = new HttpAgent({
    identity: wallet,
    host: AGENT_HOST,
  });
  const ingressActor = Actor.createActor<LedgerActor>(LedgerIDLFactory, {
    agent: myAgent,
    canisterId: ledger_principal,
  });
  return ingressActor.updateVirtualAccount(BigInt(0), {
    backingAccount: [BigInt(0)],
    state: [{ ft_set: BigInt(1000) }],
    expiration: [BigInt(1000)],
  });
}

//Specific function
async function StartProcessPing() {
  const wallet = CreateSeedPrincipals();
  const client = startClients(wallet);
  const aggregators = await client.getAggregators();

  if (!global.transactions) global.transactions = [];
  // if (wallet) {
    const promises = [
        new Promise(async (resolve, reject) => {
        //requested counter
        requested_counter.labels({ canister: ledger_principal }).inc();

        // start timer
        const start = Date.now();

        // update virtual account
        const value = await Ping(wallet!)
          .then((a) => a)
          .catch((error) => {
            console.log("error", error);
            error_counter.labels({ canister: ledger_principal }).inc();
          });
          const end = Date.now()
          const newValue = Number(value)/1_000_000;
          // end timer
          const seconds = end - start;
          let responsetime = Number(newValue) - start;
          let calltime = end - Number(newValue)
          if (responsetime < 0) responsetime = 0;
          if (calltime < 0) calltime = 0;
        // register time
        try {
          transfers_time
            .labels({ canister: ledger_principal })
            .observe(seconds);
          time_response
            .labels({ canister: ledger_principal })
            .observe(responsetime);
          time_call
            .labels({ canister: ledger_principal })
            .observe(calltime);
        } catch (error) {
          console.log("error", error);
          reject(error);
        }

        global.transactions = [];
        resolve(true);
      })
    ];

    for (const aggregator of aggregators) {
      const promise = new Promise(async (resolve, reject) => {
        const agg = aggregator.canisterPrincipal.toText()
        //requested counter
        requested_counter.labels({ canister: agg }).inc();

        // start timer
        const start = Date.now();

        // update virtual account
       const value = await PingAgg(agg,wallet!)
          .then((a) => a)
          .catch((error) => {
            console.log("error", error);
            error_counter.labels({ canister: agg }).inc();
          });
        const end = Date.now()
        const newValue = Number(value)/1_000_000;
        // end timer
        const seconds = end - start;
        let responsetime = Number(newValue) - start;
        let calltime = end - Number(newValue)
        if (responsetime < 0) responsetime = 0;
        if (calltime < 0) calltime = 0;
        // register time
        try {
          transfers_time
            .labels({ canister: agg })
            .observe(seconds);
          time_response
            .labels({ canister: agg })
            .observe(responsetime);
          time_call
            .labels({ canister: agg })
            .observe(calltime);
        } catch (error) {
          console.log("error", error);
          reject(error);
        }

        global.transactions = [];
        resolve(true);
      })
      promises.push(promise);
    }

    Promise.all(promises);
  // }
}

function Ping(wallet?: Identity) {
  const myAgent = new HttpAgent({
    identity: wallet,
    host: AGENT_HOST,
  });
  const ledgerActor = Actor.createActor<LedgerActor>(LedgerIDLFactory, {
    agent: myAgent,
    canisterId: "rqx66-eyaaa-aaaap-aaona-cai",
  });
  return ledgerActor.ping();
}

function PingAgg(aggregator: string, wallet?: Identity) {
  const myAgent = new HttpAgent({
    identity: wallet,
    host: AGENT_HOST,
  });
  const aggActor = Actor.createActor<AggActor>(AggIDLFactory, {
    agent: myAgent,
    canisterId: aggregator,
  });
  return aggActor.ping();
}

// Counts errors per aggregator
function errors(aggregator: string): void {
  error_counter.labels({ aggregator: aggregator }).inc();
}

// Counts requests per aggregator
function requested(aggregator: string): void {
  requested_counter.labels({ aggregator: aggregator }).inc();
}

// Process transactions
function MakeTransfer(
  client: HPLClient,
  aggregator?: string | Principal | null
) {
  const localId = Date.now();
  const from: TransferAccountReference = {
    type: "sub",
    id: BigInt(1),
  };
  const to: TransferAccountReference = {
    type: "sub",
    id: BigInt(2),
  };
  return runOrPickupSimpleTransfer(
    localId,
    [from, to, BigInt(1), "max"],
    client,
    () => {},
    { errors },
    aggregator
  );
}

// Initialize client of HPLClient
function startClients(wallet: Wallet): HPLClient {
  // Start the client
  const client1 = new HPLClient(
    Bun.env.LEDGER_PRINCIPAL || "",
    process.env.DFX_NETWORK as any
  );
  client1.setIdentity(wallet);

  return client1;
}
