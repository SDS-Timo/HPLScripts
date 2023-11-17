import { HPLClient, TransferAccountReference } from "@research-ag/hpl-client";
import { log, randomId, seedToIdentity } from "../utils";
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
import { Actor, HttpAgent, Identity, RequestId, randomNumber } from "@dfinity/agent";
import { pollForResponse } from "@dfinity/agent/lib/cjs/polling";
import { backoff, chain, conditionalDelay, once, timeout } from "@dfinity/agent/lib/cjs/polling/strategy";

const port = process.env.PORT || 3000;
const ledger_principal = process.env.LEDGER_PRINCIPAL || "";
const interval_time = process.env.INTERVAL_TIME || "*/10 * * * * *";
const script_mode = process.env.SCRIPT_MODE || "ALL";
const AGENT_HOST = process.env.AGENT_HOST || "https://icp0.io";
const RESET_INTERVAL = (process.env.RESET_INTERVAL || 61000 ) as number;

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
        high_watermark: "tracked_time_function_high_watermark",
      }
    };
  if(script_mode === "PING")
    return {
      data:{
        histogram: {
          name: "ping_time", 
          buckets: Prometheus.linearBuckets(0, 1000, 25)
        },
        histogram_to_canister: {
          name: "ping_time_to_canister", 
          buckets: Prometheus.linearBuckets(0, 1000, 25)
        },
        histogram_from_canister: {
          name: "ping_time_from_canister", 
          buckets: Prometheus.linearBuckets(0, 1000, 25)
        },
        error_counter: "tracked_errors_time",
        requested_counter: "tracked_requests_time",
        labels: ["canister","ping_type"],
        high_watermark: "ping_time_high_watermark",
      }
    };
  return {
    data: {
      histogram: {
        name: "transfer_time",
        buckets: Prometheus.linearBuckets(0, 1000, 25)
      },
      error_counter: "transfer_errors",
      requested_counter: "transfer_requests",
      labels: ["aggregator"],
      high_watermark: "transfer_time_high_watermark",
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

const to_canister = new Prometheus.Histogram({
  name: getData().data.histogram_to_canister?.name || "ping_time_response",
  help: "Count of time took to process",
  labelNames: getData().data.labels,
  buckets: getData().data.histogram_to_canister?.buckets || [],
});
register.registerMetric(to_canister);

const from_canister = new Prometheus.Histogram({
  name: getData().data.histogram_from_canister?.name || "ping_time_call",
  help: "Count of time took to process",
  labelNames: getData().data.labels,
  buckets: getData().data.histogram_from_canister?.buckets  || [],
});
register.registerMetric(from_canister);

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

const high_watermark = new Prometheus.Gauge({
  name: getData().data.high_watermark,
  help: "Shows highest value",
  labelNames: getData().data.labels,
});
register.registerMetric(high_watermark);

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

function setWaterMark(seconds: number, labels: any,label:string) {
  if(!global.high_gauge || !global.high_gauge_dates){
    global.high_gauge = new Map();
    global.high_gauge_dates = new Map();
  }
  const reslh = global.high_gauge.get(label);
  const resl_date = global.high_gauge_dates.get(label);
  if((!reslh || !resl_date) || Number(reslh) < seconds || (Date.now() > (Number(resl_date) + RESET_INTERVAL))){
    global.high_gauge.set(label, seconds);
    global.high_gauge_dates.set(label, Date.now());
    high_watermark.labels(labels).set(seconds);
  }
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
      const data = await MakeTransfer(client);
      const seconds = Date.now() - start;
      try {
        log(["localId:",data.localId,"TxId:",data.TxId,"aggregator:","all", "seconds:", seconds]);
        if(!data.err){
          transfers_time.labels({ aggregator: "all" }).observe(seconds);
          setWaterMark(seconds,{aggregator: "all"},"all");
        }
          
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
      const data = await MakeTransfer(client, aggregator.canisterPrincipal); 
      const seconds = Date.now() - start;
      
      try {
        log(["localId:",data.localId,"TxId:",data.TxId,"aggregator:",aggPrincipal, "seconds:", seconds]);
        if(!data.err){
          transfers_time.labels({ aggregator: aggPrincipal }).observe(seconds);
          setWaterMark(seconds,{aggregator: aggPrincipal},aggPrincipal);
        }
          
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
        const localId = getId();
        // start timer
        const start = Date.now();
        log(["localId:",localId,"Start"]);
        // update virtual account
        await updateVirtualAccount(localId,wallet!)
          .then((a) => console.log("result", a))
          .catch(async (error) => {
            console.log("error", error);
            log(["localId:",localId, "seconds:", seconds, "error:", JSON.stringify(error)]);
            error_counter.labels({ function: "updateVirtualAccount" }).inc();
          });
        // end timer
        const seconds = Date.now() - start;
        log(["localId:",localId, "seconds:", seconds, "function:", "updateVirtualAccount","End"]);
        // register time
        try {
          transfers_time
            .labels({ function: "updateVirtualAccount" })
            .observe(seconds);
            setWaterMark(seconds,{function: "updateVirtualAccount"},"updateVirtualAccount");
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
        const localId = getId();
        // start timer
        const start = Date.now();
        log(["localId:",localId,"canister:",ledger_principal,"Start"]);
        // update virtual account
        const value = await Ping(localId,wallet!)
          .then((a) => a)
          .catch((error) => {
            console.log("error", error);
            error_counter.labels({ canister: ledger_principal }).inc();
          });
          const end = Date.now()
        // register time
        try {
          setValuesPing(localId,ledger_principal,start,end,Number(value))
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
        const localId = getId();
        log(["localId:",localId,"canister:",agg,"Start"]);
        // update virtual account
       const value = await PingAgg(localId,agg,wallet!)
          .then((a) => a)
          .catch((error) => {
            console.log("error", error);
            error_counter.labels({ canister: agg }).inc();
          });
        const end = Date.now()
        // register time
        try {
            setValuesPing(localId,agg,start,end,Number(value))
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

function setValuesPing(
  localId: string,
  canister: string,
  start: number,
  end: number,
  value: number
) {
  const newValue = Number(value) / 1_000_000;
  const seconds = end - start;
  let t_canister = Number(newValue) - start;
  let f_canister = end - Number(newValue);
  if (t_canister < 0) t_canister = 0;
  if (f_canister < 0) f_canister = 0;
  log(["localId:", localId, "canister:", canister, "seconds:", seconds]);
  log(["localId:", localId, "canister:", canister, "to_canister:", t_canister]);
  log([
    "localId:",
    localId,
    "canister:",
    canister,
    "from_canister:",
    f_canister,
  ]);
  // register time
  transfers_time.labels({ canister: canister }).observe(seconds);
  to_canister.labels({ canister: canister }).observe(t_canister);
  from_canister.labels({ canister: canister }).observe(f_canister);
  setWaterMark(
    seconds,
    { canister: canister, ping_type: "ping_time" },
    canister
  );
  setWaterMark(
    f_canister,
    { canister: canister, ping_type: "ping_time_from_canister" },
    canister + "_from_canister"
  );
  setWaterMark(
    t_canister,
    { canister: canister, ping_type: "ping_time_to_canister" },
    canister + "_to_canister"
  );
}

async function updateVirtualAccount(localId: string, wallet?: Identity, ) {
  log(["localId:",localId, "Start Agent"]);
  const myAgent = new HttpAgent({
    identity: wallet,
    host: AGENT_HOST,
  });
  log(["localId:",localId,"Create Actor"]);
  const ingressActor = Actor.createActor<LedgerActor>(LedgerIDLFactory, {
    agent: myAgent,
    canisterId: ledger_principal,
  });
  log(["localId:",localId, "Execute Function"]);
  return ingressActor.updateVirtualAccount(BigInt(0), {
    backingAccount: [BigInt(0)],
    state: [{ ft_set: BigInt(1000) }],
    expiration: [BigInt(1000)],
  });
}

function pollingStrategy() {return chain(conditionalDelay(once(), 250), timeout(5 * 60 * 1000))}

async function Ping(localId: string, wallet?: Identity) {
  log(["localId:",localId,"canister:",ledger_principal, "Start Agent"]);
  const myAgent = new HttpAgent({
    identity: wallet,
    host: AGENT_HOST,
  });
  log(["localId:",localId,"canister:",ledger_principal,"Create Actor"]);
  const ledgerActor = Actor.createActor<LedgerActor>(LedgerIDLFactory, {
    agent: myAgent,
    canisterId: ledger_principal,
    pollingStrategyFactory: () => {
      return pollingStrategy()
    }
  });
  log(["localId:",localId,"canister:",ledger_principal, "Execute Function"]);
  return ledgerActor.ping();
}

async function PingAgg(localId:string, aggregator: string, wallet?: Identity) {
  log(["localId:",localId,"canister:",aggregator, "Start Agent"]);
  const myAgent = new HttpAgent({
    identity: wallet,
    host: AGENT_HOST,
  });
  log(["localId:",localId,"canister:",aggregator,"Create Actor"]);
  const aggActor = Actor.createActor<AggActor>(AggIDLFactory, {
    agent: myAgent,
    canisterId: aggregator,
    pollingStrategyFactory: () => {
      return pollingStrategy()
    }
  });
  log(["localId:",localId,"canister:",aggregator, "Execute Function"]);
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
async function MakeTransfer(
  client: HPLClient,
  aggregator?: string | Principal | null
) {
  const localId = getId();
  const from: TransferAccountReference = {
    type: "sub",
    id: BigInt(1),
  };
  const to: TransferAccountReference = {
    type: "sub",
    id: BigInt(2),
  };
  const data = await runOrPickupSimpleTransfer(
    localId,
    [from, to, BigInt(1), "max"],
    client,
    () => {},
    { errors },
    aggregator
  );
  return {TxId:data.txId, localId, err: data.err};
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

function getId(){
  return Date.now() + randomId(10);
}