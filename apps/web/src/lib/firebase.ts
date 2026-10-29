import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth } from "firebase/auth";

// Public web config: it identifies the Firebase project, it is not a secret.
const app = initializeApp({
  apiKey: "AIzaSyDRNv2eMMX7DwBAGrDo3PGXaGwBqsygtvM",
  authDomain: "teejayproject.firebaseapp.com",
  projectId: "teejayproject",
  appId: "1:974343814740:web:c8fcd1dc3f7d87ab3e37c1",
});

export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
