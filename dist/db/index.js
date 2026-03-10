"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.client = void 0;
exports.setupDbSync = setupDbSync;
const libsql_1 = require("drizzle-orm/libsql");
const client_1 = require("@libsql/client");
const schema = __importStar(require("./schema"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
exports.client = (0, client_1.createClient)({
    url: process.env.DATABASE_URL || 'file:./dev.db',
});
// Phase 13: Enable Write-Ahead Logging to prevent SQLITE_BUSY locked DB errors
// This allows simultaneous read/writes between the Scraper and the API/Frontend
async function setupDbSync() {
    await exports.client.execute('PRAGMA journal_mode = WAL;');
    await exports.client.execute('PRAGMA busy_timeout = 5000;');
}
exports.db = (0, libsql_1.drizzle)(exports.client, { schema });
