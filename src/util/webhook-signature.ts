import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { usageError } from '../http/errors.js';

export interface VerifyWhoopSignatureInput {
  timestamp: string;
  rawBody: string;
  clientSecret: string;
  signature: string;
}

export const buildWhoopSignature = (
  timestamp: string,
  rawBody: string,
  clientSecret: string,
): string => {
  const payload = `${timestamp}${rawBody}`;
  const digest = createHmac('sha256', clientSecret).update(payload).digest('base64');
  return digest;
};

const safeCompare = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
};

export const verifyWhoopSignature = ({
  timestamp,
  rawBody,
  clientSecret,
  signature,
}: VerifyWhoopSignatureInput): boolean => {
  const expected = buildWhoopSignature(timestamp, rawBody, clientSecret);
  return safeCompare(expected, signature.trim());
};

export const readRawBodyFromFile = async (filePath: string): Promise<string> => {
  if (!filePath) throw usageError('body-file is required');
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    throw usageError('Unable to read body file', {
      filePath,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
};
