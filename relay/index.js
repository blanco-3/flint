#!/usr/bin/env node

const { createRelayServer } = require("./server");
const { FileRelayStore, defaultStateFile } = require("./store");
const { sendWebhook } = require("./notifier");
const { createWatchService } = require("./watch");

async function main() {
  const port = Number(process.env.FLINT_RELAY_PORT || 8787);
  const stateFile = process.env.FLINT_RELAY_STATE_FILE || defaultStateFile();
  const store = new FileRelayStore(stateFile);
  await store.init();

  const server = createRelayServer({
    store,
    notifier: sendWebhook,
    watchService: createWatchService(),
  });

  server.listen(port, () => {
    console.log(
      JSON.stringify(
        {
          service: "flint-relay-alpha",
          port,
          stateFile,
        },
        null,
        2
      )
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
