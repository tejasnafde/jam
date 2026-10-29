import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { SAMPLE_BUCKET } from "@jam/shared";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SoundIndex } from "./sounds/soundIndex.js";
import { GcsBlobs } from "./store/blobs.js";
import { FirestoreStore } from "./store/firestore.js";
import { FirestoreSampleStore } from "./store/firestoreSamples.js";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);

const firebase = initializeApp({ credential: applicationDefault(), projectId: config.GOOGLE_CLOUD_PROJECT });
const db = getFirestore(firebase, config.FIRESTORE_DATABASE);
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(firebase);

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = config.STATIC_DIR ?? path.resolve(here, "../../web/dist");

const app = createApp({
  store: new FirestoreStore(db),
  samples: new FirestoreSampleStore(db, log),
  blobs: new GcsBlobs(getStorage(firebase).bucket(SAMPLE_BUCKET)),
  sounds: new SoundIndex(),
  verifyIdToken: async (idToken) => {
    const decoded = await auth.verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email };
  },
  staticDir,
  log,
});

app.listen(config.PORT, () => {
  log.info("listening", { port: config.PORT, database: config.FIRESTORE_DATABASE, staticDir });
});
