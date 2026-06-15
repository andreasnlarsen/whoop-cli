import { createInterface as createCallbackInterface } from 'node:readline';
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

  return new Promise((resolve) => {
    const rl = createCallbackInterface({ input, output, terminal: true });
    const muted = rl as typeof rl & {
      _writeToOutput?: (value: string) => void;
      stdoutMuted?: boolean;
    };
    const writeToOutput = muted._writeToOutput?.bind(rl);

    muted.stdoutMuted = true;
    muted._writeToOutput = (value: string): void => {
      if (!muted.stdoutMuted || value.includes('\n') || value.includes('\r')) {
        writeToOutput?.(value);
      }
    };

    output.write(question);
    rl.question('', (answer) => {
      muted.stdoutMuted = false;
      rl.close();
      output.write('\n');
      resolve(answer);
    });
  });
};
