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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptKey = encryptKey;
exports.decryptKey = decryptKey;
const crypto_js_1 = __importDefault(require("crypto-js"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-insecure-key-do-not-use-in-prod-123!';
/**
 * Encrypts a private key using AES
 */
function encryptKey(privateKey) {
    return crypto_js_1.default.AES.encrypt(privateKey, ENCRYPTION_KEY).toString();
}
/**
 * Decrypts an encrypted private key using AES
 */
function decryptKey(encryptedKey) {
    const bytes = crypto_js_1.default.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
    return bytes.toString(crypto_js_1.default.enc.Utf8);
}
