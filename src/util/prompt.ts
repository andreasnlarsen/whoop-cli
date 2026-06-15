import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const canPrompt = (): boolean => Boolean(input.isTTY && output.isTTY);

export const ask = async (question: string): Promise<string> => {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer;
  } finally {
    rl.close();
  }
};

export const askHidden = async (question: string): Promise<string> => {
  if (!canPrompt()) {
    return ask(question);
  }

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let answer = '';
    let settled = false;

    const cleanup = (): void => {
      input.off('data', onData);
      input.off('error', onError);
      input.setRawMode(wasRaw);
      input.pause();
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      output.write('\n');
      resolve(answer);
    };

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      output.write('\n');
      reject(err);
    };

    const onError = (err: Error): void => {
      fail(err);
    };

    const onData = (chunk: Buffer | string): void => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }

        if (char === '\u0003') {
          fail(new Error('Aborted with Ctrl+C'));
          return;
        }

        if (char === '\u007f' || char === '\b') {
          answer = answer.slice(0, -1);
          continue;
        }

        if (char >= ' ') {
          answer += char;
        }
      }
    };

    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    input.on('error', onError);
  });
};
