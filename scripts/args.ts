/** Shared argument handling for the scaffolding scripts. */

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2);
      if (!name) continue;
      if (inline !== undefined) {
        flags[name] = inline;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = 'true';
      }
      continue;
    }
    positional.push(arg);
  }

  return { positional, flags };
}

/**
 * Read a named flag the way it actually arrives.
 *
 * `npm run new:subject "X" --category y` never reaches the script as `--category y`: npm
 * consumes the flag and re-exposes it as `npm_config_category`, leaving `y` as a bare
 * positional. All three forms are accepted, so the documented invocation works and a direct
 * `tsx scripts/new-subject.ts "X" --category y` works too.
 */
export function flag(args: ParsedArgs, name: string, positionalIndex: number): string | undefined {
  const fromArgv = args.flags[name];
  if (fromArgv !== undefined && fromArgv !== 'true') return fromArgv;
  const fromNpm = process.env[`npm_config_${name}`];
  if (fromNpm !== undefined && fromNpm !== '' && fromNpm !== 'true') return fromNpm;
  return args.positional[positionalIndex];
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
