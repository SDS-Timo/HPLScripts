"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var hpl_client_1 = require("@research-ag/hpl-client");
var utils_1 = require("../utils");
// CreateSeeds
function CreateSeedPrincipals() {
    var wallet1 = (0, utils_1.seedToIdentity)(Bun.env.PRINCIPAL1_SECRET_KEY || "");
    var wallet2 = (0, utils_1.seedToIdentity)(Bun.env.PRINCIPAL2_SECRET_KEY || "");
    return [wallet1, wallet2];
}
// StartProcess
function StartProcess() {
    return __awaiter(this, void 0, void 0, function () {
        var duplaWallet, DuplaClients;
        return __generator(this, function (_a) {
            duplaWallet = CreateSeedPrincipals();
            DuplaClients = startClients(duplaWallet);
            return [2 /*return*/];
        });
    });
}
StartProcess();
function startClients(wallet) {
    // Start the client
    var client1 = new hpl_client_1.HPLClient(Bun.env.LEDGER_PRINCIPAL || "", process.env.DFX_NETWORK);
    client1.setIdentity(wallet[0]);
    var client2 = new hpl_client_1.HPLClient(Bun.env.LEDGER_PRINCIPAL || "", process.env.DFX_NETWORK);
    client2.setIdentity(wallet[1]);
    return [client1, client2];
}
// rr7sh-evhti-utofa-gr2iv-jncnp-ihsyw-aciqc-inbsm-dptfm-ql53r-2qe == Ajinomoto
// qsxz5-j45vr-hwul2-ytt2e-g2bro-q7xnd-ycmmp-h7chi-4fz67-34mq5-iqe == Ajinomoto2
// 54
// token create
// account open
// virtual account open
//CreateTokens
function CreateTokens(wallet1, wallet2) {
}
// Wallet to wallet
// Mint to subaccount
// Mint to virtual account
// subaccount to subaccount
// subaccount to virtual account
// virtual to subaccount
