import type { EncryptedBlob } from "@/types";

export const PBKDF2_ITERATIONS = 310_000;

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function deriveAesKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    // extractable——解锁后密钥需导出存入 storage.session 供各上下文复用
    true,
    ["encrypt", "decrypt"],
  );
}

export async function exportKeyB64(key: CryptoKey): Promise<string> {
  return toB64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importKeyB64(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(b64), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptString(key: CryptoKey, plain: string): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

/** 密钥不对或密文损坏时 WebCrypto 抛 OperationError */
export async function decryptString(key: CryptoKey, blob: EncryptedBlob): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(blob.iv) },
    key,
    fromB64(blob.ciphertext),
  );
  return new TextDecoder().decode(plain);
}
