import { HPLClient, TransferAccountReference } from "@research-ag/hpl-client";
import { seedToIdentity } from "../utils";
import { Wallet } from "./models/models";
import { runOrPickupSimpleTransfer } from "./scripts/transfer";
import Prometheus from 'prom-client';
import { Elysia } from 'elysia'
import { cron } from '@elysiajs/cron'
import { Principal } from "@dfinity/principal";
const port = process.env.PORT || 3000
const interval_time = process.env.INTERVAL_TIME || '*/10 * * * * *';
const script_mode = process.env.SCRIPT_MODE || "ALL";

/// ============== PROMETHEUS ==============
const register = new Prometheus.Registry();

const transfers_time = new Prometheus.Histogram({
    name: 'transfer_time',
    help: 'Count of time took to transfer',
    labelNames: ['aggregator'],
    buckets: Prometheus.linearBuckets(0, 1000, 50),
});
register.registerMetric(transfers_time);

const error_counter = new Prometheus.Counter({
    name: 'transfer_errors',
    help: 'Count of errors on transfer',
    labelNames: ['aggregator'],
});
register.registerMetric(error_counter);

const requested_counter = new Prometheus.Counter({
    name: 'transfer_requests',
    help: 'Count of requests on transfer',
    labelNames: ['aggregator'],
});
register.registerMetric(requested_counter);

register.setDefaultLabels({
    app: 'hpl-transfers',
});

/// ============== CRON THAT ACTIVATES PROCESS ==============
new Elysia()
    .use(
        cron({
            name: 'execute-transfer',
            pattern: interval_time,
            run() {
                if(script_mode === "ALL")
                    StartProcess();
                if(script_mode === "AGGREGATOR")
                    StartProcessPerAggregator()
            }
        }),
    )
    .listen(8080)

/// ============== BUN SERVER ==============
const server = Bun.serve({
    port: port,
    fetch(request) {
       return controller(request);     
    },
});
  
console.log(`Listening on localhost: ${server.port}`);


// Controller to show metrics
async function Metrics(request:Request):Promise<Response> {
    const data = await register.metrics();
    return new Response(data, {
        status: 200,
        headers: {
            'Content-Type': register.contentType,
        },
    });
}

// General controller
async function controller(request:Request):Promise<Response> {
    if (new URL(request.url).pathname  === "/") return new Response("Welcome to Bun!");
    else if (new URL(request.url).pathname  === "/metrics") return await Metrics(request);
    else return new Response("Not found", { status: 404 });
}


// =============== Process Funtions ==============
// CreateSeeds
function CreateSeedPrincipals():Wallet {
    return seedToIdentity(Bun.env.PRINCIPAL1_SECRET_KEY || "");
}

// StartProcess
async function StartProcess() {
    const wallet = CreateSeedPrincipals();
    const client = startClients(wallet); 

    if(!global.transactions)  global.transactions = [];
    const promises = [new Promise(async (resolve, reject) => {

        requested("all");

        const start = Date.now();
        await MakeTransfer(client);
        const seconds =  (Date.now() - start);
            
        try {
            transfers_time.labels({aggregator:"all"}).observe(seconds);   
        } catch (error) {
            console.log("error", error);
            reject(error);
        }
        
        global.transactions = [];
        resolve(true);
    })];
   
    Promise.all(promises)
}

async function StartProcessPerAggregator() {
    const wallet = CreateSeedPrincipals();
    const client = startClients(wallet); 
    const aggregators = await client.getAggregators();
    const promises = [];

    if(!global.transactions)  global.transactions = [];
    for (const aggregator of aggregators) {
        const promise = new Promise(async (resolve, reject) => {
            const aggPrincipal = aggregator.canisterPrincipal.toText()
            requested(aggPrincipal);
    
            const start = Date.now();
            await MakeTransfer(client,aggregator.canisterPrincipal);
            const seconds =  (Date.now() - start);
                
            try {
                transfers_time.labels({aggregator:aggPrincipal}).observe(seconds);   
            } catch (error) {
                console.log("error", error);
                reject(error);
            }
            
            global.transactions = [];
            resolve(true);
        })
        promises.push(promise);
    }
   
   
    Promise.all(promises)
}

// Counts errors per aggregator
function errors(aggregator: string):void {
    error_counter.labels({aggregator:aggregator}).inc();
}

// Counts requests per aggregator
function requested(aggregator: string):void {
    requested_counter.labels({aggregator:aggregator}).inc();
}

// Process transactions
function MakeTransfer(client:HPLClient, aggregator?: string | Principal | null) {
   
    const localId = Date.now();
    const from: TransferAccountReference = {
        type: 'sub',
        id: BigInt(1),
    }
    const to: TransferAccountReference = {
        type: 'sub',
        id: BigInt(2),
    }
   return runOrPickupSimpleTransfer(localId, [from, to,BigInt(1), "max"], client, ()=>{},{errors},aggregator)
}

// Initialize client of HPLClient
function startClients(wallet:Wallet): HPLClient {
    // Start the client
    const client1 = new HPLClient(Bun.env.LEDGER_PRINCIPAL || "", process.env.DFX_NETWORK as any);
    client1.setIdentity(wallet);

    return client1;
}
