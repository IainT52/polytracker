import CryptoJS from 'crypto-js';
import * as dotenv from 'dotenv';
dotenv.config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-insecure-key-do-not-use-in-prod-123!';

/**
 * Encrypts a private key using AES
 */
export function encryptKey(privateKey: string): string {
  return CryptoJS.AES.encrypt(privateKey, ENCRYPTION_KEY).toString();
}

/**
 * Decrypts an encrypted private key using AES
 */
export function decryptKey(encryptedKey: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
