// ---------------------------------------------------------------------------
// E-Way Bill Crypto Service — NIC v1.03 Encryption/Decryption
// ---------------------------------------------------------------------------
// Implements the exact encryption mechanism required by the official
// E-Way Bill System (NIC) API v1.03:
//
//   AUTHENTICATION:
//     1. Build JSON payload { action, username, password, app_key }
//     2. Convert to string → byte array
//     3. Base64 encode the byte array
//     4. Encrypt the Base64 output with NIC EWB Public Key (RSA/ECB/PKCS1)
//     5. POST { "Data": "<encrypted>" } to auth endpoint
//     6. Receive { authtoken, sek } where sek is encrypted with app_key
//     7. Decrypt sek using app_key (AES/ECB/PKCS5)
//
//   API CALLS:
//     1. Build JSON payload
//     2. Base64 encode
//     3. Encrypt with decrypted SEK (AES/CBC/PKCS5, random 16-byte IV)
//     4. POST { "data": { "Content": "<encrypted>" } }
//     5. Decrypt response: first 16 bytes = IV, remainder = ciphertext
//
// Reference: https://docs.ewaybillgst.gov.in/apidocs/version1.03/
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes, createPublicKey } from "node:crypto";

// ── App Key Generation ────────────────────────────────────────────────────

/**
 * Generate a random 256-bit (32-byte) app_key.
 * The raw bytes are used as the AES key.
 * The Base64-encoded string (44 chars) is sent in the auth payload.
 */
export function generateAppKey(): { raw: Buffer; base64: string } {
  const raw = randomBytes(32);
  return { raw, base64: raw.toString("base64") };
}

// ── Base64 Helpers ────────────────────────────────────────────────────────

export function encodeBase64(data: string | Buffer): string {
  if (typeof data === "string") {
    return Buffer.from(data, "utf-8").toString("base64");
  }
  return data.toString("base64");
}

export function decodeBase64(base64Str: string): Buffer {
  return Buffer.from(base64Str, "base64");
}

// ── RSA Public Key Encryption (for Authentication) ───────────────────────

/**
 * Encrypt data using the NIC EWB Public Key.
 *
 * The NIC provides a public key (PEM format) for encrypting authentication
 * credentials. This uses RSA/ECB/PKCS1Padding (standard RSA PKCS#1 v1.5).
 *
 * @param plaintext - The Base64-encoded credential string to encrypt
 * @param publicKeyPem - The NIC EWB public key in PEM format
 * @returns Base64-encoded ciphertext
 */
export function encryptWithPublicKey(
  plaintext: string,
  publicKeyPem: string,
): string {
  const publicKey = createPublicKey(publicKeyPem);
  const buffer = Buffer.from(plaintext, "utf-8");
  // Node.js crypto RSA encryption uses PKCS1 by default
  const encrypted = require("node:crypto").publicEncrypt(
    {
      key: publicKey,
      padding: require("node:crypto").constants.RSA_PKCS1_PADDING,
    },
    buffer,
  );
  return encrypted.toString("base64");
}

// ── AES/ECB Decryption (for SEK) ─────────────────────────────────────────

/**
 * Decrypt the SEK returned by the NIC auth endpoint.
 *
 * The SEK is encrypted with the app_key using AES/ECB/PKCS5Padding.
 * ECB mode has no IV — the same key always produces the same output.
 *
 * @param encryptedSek - Base64-encoded encrypted SEK from auth response
 * @param appKeyRaw - The raw 32-byte app_key Buffer
 * @returns Decrypted SEK string (Base64-encoded AES key for API calls)
 */
export function decryptSek(encryptedSek: string, appKeyRaw: Buffer): string {
  const cipherBuf = decodeBase64(encryptedSek);
  const decipher = createDecipheriv("aes-256-ecb", appKeyRaw, null);
  decipher.setAutoPadding(true); // PKCS5/PKCS7
  const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  return decrypted.toString("utf-8");
}

// ── AES/CBC Encryption (for API request payloads) ────────────────────────

/**
 * Encrypt a JSON payload using the decrypted SEK.
 *
 * Flow per NIC v1.03:
 *   1. Serialize the payload to JSON string
 *   2. Base64 encode the JSON string
 *   3. Generate a random 16-byte IV
 *   4. Encrypt with AES-256-CBC using SEK as key and random IV
 *   5. Prepend IV to ciphertext
 *   6. Base64 encode the result
 *
 * @param payload - The JSON-serializable request payload
 * @param sekRaw - The decrypted SEK as a string (Base64-encoded 32-byte key)
 * @returns Base64-encoded "IV + ciphertext" for the API request
 */
export function encryptWithSek(payload: Record<string, any>, sekRaw: string): string {
  // 1. JSON serialize
  const jsonStr = JSON.stringify(payload);

  // 2. Base64 encode the JSON string
  const b64Payload = encodeBase64(jsonStr);

  // 3. Generate random 16-byte IV
  const iv = randomBytes(16);

  // 4. Decode SEK from Base64 to get raw 32-byte key
  const sekKey = decodeBase64(sekRaw);

  // 5. Encrypt with AES-256-CBC
  const cipher = createCipheriv("aes-256-cbc", sekKey, iv);
  cipher.setAutoPadding(true); // PKCS5/PKCS7
  const encrypted = Buffer.concat([cipher.update(b64Payload, "utf-8"), cipher.final()]);

  // 6. Prepend IV to ciphertext and Base64 encode
  const result = Buffer.concat([iv, encrypted]);
  return result.toString("base64");
}

// ── AES/CBC Decryption (for API response payloads) ───────────────────────

/**
 * Decrypt an API response payload using the decrypted SEK.
 *
 * Response format: first 16 bytes = IV, remainder = AES-256-CBC ciphertext.
 *
 * @param encryptedResponse - Base64-encoded encrypted response from NIC
 * @param sekRaw - The decrypted SEK as a string (Base64-encoded 32-byte key)
 * @returns Parsed JSON response object
 */
export function decryptWithSek<T = Record<string, any>>(
  encryptedResponse: string,
  sekRaw: string,
): T {
  const fullBuf = decodeBase64(encryptedResponse);

  // First 16 bytes are the IV
  if (fullBuf.length < 16) {
    throw new Error("Invalid encrypted response: too short to contain IV");
  }
  const iv = fullBuf.subarray(0, 16);
  const ciphertext = fullBuf.subarray(16);

  // Decode SEK
  const sekKey = decodeBase64(sekRaw);

  // Decrypt
  const decipher = createDecipheriv("aes-256-cbc", sekKey, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // The decrypted content is Base64-encoded JSON
  const b64Json = decrypted.toString("utf-8");
  const jsonStr = decodeBase64(b64Json).toString("utf-8");

  return JSON.parse(jsonStr) as T;
}

// ── Full Authentication Payload Encryption ────────────────────────────────

/**
 * Build and encrypt the authentication payload per NIC v1.03 spec.
 *
 * @param username - EWB API username
 * @param password - EWB API password
 * @param appKeyBase64 - The Base64-encoded app_key
 * @param publicKeyPem - The NIC EWB public key (PEM format)
 * @returns Base64-encoded encrypted payload for the "Data" field
 */
export function buildAuthPayload(
  username: string,
  password: string,
  appKeyBase64: string,
  publicKeyPem: string,
): string {
  // 1. Build the credentials JSON
  const creds = {
    action: "ACCESSTOKEN",
    username,
    password,
    app_key: appKeyBase64,
  };

  // 2. Convert to JSON string → byte array → Base64
  const jsonStr = JSON.stringify(creds);
  const b64Creds = encodeBase64(jsonStr);

  // 3. Encrypt with NIC EWB public key
  return encryptWithPublicKey(b64Creds, publicKeyPem);
}

// ── Exports Summary ───────────────────────────────────────────────────────
// generateAppKey()           → { raw, base64 }
// encryptWithPublicKey()     → RSA encrypt for auth
// decryptSek()               → AES/ECB decrypt SEK
// encryptWithSek()           → AES/CBC encrypt API payloads
// decryptWithSek()           → AES/CBC decrypt API responses
// buildAuthPayload()         → Full auth payload builder
// encodeBase64() / decodeBase64()
