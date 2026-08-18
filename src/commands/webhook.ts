import { Command } from 'commander';
import { getGlobalOptions, printData, printError } from './context.js';
import { configError, usageError } from '../http/errors.js';
import { readRawBodyFromFile, verifyWhoopSignature } from '../util/webhook-signature.js';
import { loadProfileClientSecret } from '../store/profile-store.js';

export const registerWebhookCommands = (program: Command): void => {
  const webhook = program.command('webhook').description('Webhook helpers');

  webhook
    .command('verify')
    .description('Verify WHOOP webhook signature')
    .requiredOption('--timestamp <timestamp>', 'X-WHOOP-Signature-Timestamp header value')
    .requiredOption('--signature <signature>', 'X-WHOOP-Signature header value')
    .requiredOption('--body-file <path>', 'raw webhook body file path')
    .action(async function verifyAction(opts) {
      try {
        const globals = getGlobalOptions(this);
        const secret = await loadProfileClientSecret(globals.profile);
        const timestamp = String(opts.timestamp ?? '');
        const signature = String(opts.signature ?? '');
        const bodyFile = String(opts.bodyFile ?? '');

        if (!secret) {
          throw configError(`Profile "${globals.profile}" has no stored WHOOP client secret. Run whoop auth login first.`);
        }

        if (!timestamp || !signature || !bodyFile) {
          throw usageError('timestamp, signature, and body-file are required');
        }

        const rawBody = await readRawBodyFromFile(bodyFile);
        const valid = verifyWhoopSignature({
          timestamp,
          rawBody,
          clientSecret: secret,
          signature,
        });

        printData(this, {
          valid,
        });
      } catch (err) {
        printError(this, err);
      }
    });
};
