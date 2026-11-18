"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

export function getClientFirebaseAuth() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : "");
  if (!projectId || !apiKey || !authDomain) {
    throw new Error("A configuração pública do Firebase está incompleta. Confira NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_API_KEY e NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.");
  }
  const app = getApps().length ? getApp() : initializeApp({ projectId, apiKey, authDomain });
  return getAuth(app);
}
