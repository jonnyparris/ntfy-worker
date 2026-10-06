import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	accountId: "4b430e167a301330d13a9bb42f3986a2", // jonnyparris
	worker: {
		name: "ntfy-worker",
		compatibilityDate: "2025-01-01",
		entrypoint: "src/worker.js",
		workersDev: true,
		observability: {
			enabled: true,
		},
		env: {
			NTFY_TOKEN: bindings.secret(),
			TOPIC_ROOM: bindings.durableObject({
				worker: "ntfy-worker",
				exportName: "TopicRoom",
			}),
		},
		// Replaces Wrangler `migrations`. The provisioned namespace is SQLite even
		// though the old config said `new_classes`. cf checks this before deploy.
		exports: {
			TopicRoom: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
