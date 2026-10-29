import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SoundIndex } from "./sounds/soundIndex.js";
import { cloudRunJobRunner } from "./prep/runner.js";
import { FirestoreStore } from "./store/firestore.js";
import { FirestorePrepStore } from "./store/prep.js";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);

const credential = applicationDefault();
const firebase = initializeApp({ credential, projectId: config.GOOGLE_CLOUD_PROJECT });
const db = getFirestore(firebase, config.FIRESTORE_DATABASE);
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(firebase);

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = config.STATIC_DIR ?? path.resolve(here, "../../web/dist");

const app = createApp({
  store: new FirestoreStore(db),
  sounds: new SoundIndex(),
  verifyIdToken: async (idToken) => {
    const decoded = await auth.verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email };
  },
  prep: {
    store: new FirestorePrepStore(db),
    run: cloudRunJobRunner({
      project: config.GOOGLE_CLOUD_PROJECT,
      region: config.GOOGLE_CLOUD_REGION,
      job: config.PREP_JOB,
      getAccessToken: async () => (await credential.getAccessToken()).access_token,
    }),
  },
  staticDir,
  log,
});

app.listen(config.PORT, () => {
  log.info("listening", { port: config.PORT, database: config.FIRESTORE_DATABASE, staticDir });
});
