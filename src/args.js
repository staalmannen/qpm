// Command-line argument parsing for qpm.
//
// Kept apart from cli.js so it can be imported (and tested) on any engine:
// cli.js wires in a host adapter, and importing the Node one pulls in
// node:http and friends.

/**
 * Parse argv into { command, args, flags }.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const flags = {
    dir: null,
    registry: null,
    dev: false,
    json: false,
    help: false
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" || a === "-C") {
      flags.dir = argv[++i];
    } else if (a === "--registry") {
      flags.registry = argv[++i];
    } else if (a === "--dev") {
      flags.dev = true;
    } else if (a === "--json") {
      flags.json = true;
    } else if (a === "--help" || a === "-h") {
      flags.help = true;
    } else if (a.startsWith("-")) {
      throw new Error("Unknown option: " + a);
    } else {
      positional.push(a);
    }
  }
  const command = positional[0] || "help";
  const args = positional.slice(1);
  return { command, args, flags };
}
