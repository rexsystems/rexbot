import { request } from "@playwright/test";

export const STORAGE_STATE = "test-results/.auth/admin.json";

/** Creates the first (admin) account once and shares its session cookie with every test. */
export default async function globalSetup() {
  const api = await request.newContext({ baseURL: "http://127.0.0.1:18787" });
  const state = await (await api.get("/auth/state")).json() as { needsSetup: boolean };
  const credentials = { name: "UI Tester", email: "ui@example.com", password: "ui-test-password" };
  const response = state.needsSetup ? await api.post("/auth/signup", { data: credentials }) : await api.post("/auth/login", { data: credentials });
  if (!response.ok()) throw new Error(`Could not sign in the UI test account: ${response.status()} ${await response.text()}`);
  await api.storageState({ path: STORAGE_STATE });
  await api.dispose();
}
