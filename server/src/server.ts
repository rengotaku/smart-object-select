import { createServerApp } from "./app";
import { createNodeTransformersSamRuntime } from "./nodeTransformersLoader";

const PORT = Number(process.env.SERVER_PORT ?? 8787);

const runtime = createNodeTransformersSamRuntime();
const app = createServerApp(runtime);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] smart-object-select inference server listening on http://localhost:${PORT}`);
});
