import { cache } from "react";
import { cols } from "../db";
import { defaultSettings, DEFAULT_EMAIL_TEMPLATES } from "../settings-defaults";
import type { SettingsDoc } from "../types";

async function load(): Promise<SettingsDoc> {
  const c = await cols();
  const doc = await c.settings.findOne({ _id: "global" });
  const defaults = defaultSettings();
  if (!doc) return defaults;
  // Merge so new template keys/fields added in code appear without a migration.
  return {
    ...defaults,
    ...doc,
    bank: { ...defaults.bank, ...doc.bank },
    numbering: { ...defaults.numbering, ...doc.numbering },
    emailTemplates: { ...DEFAULT_EMAIL_TEMPLATES, ...doc.emailTemplates },
  };
}

export const getSettings = cache(load);

export async function ensureSettings(): Promise<void> {
  const c = await cols();
  await c.settings.updateOne({ _id: "global" }, { $setOnInsert: defaultSettings() }, { upsert: true });
}

export async function updateSettings(patch: Partial<Omit<SettingsDoc, "_id">>): Promise<SettingsDoc> {
  const c = await cols();
  await ensureSettings();
  await c.settings.updateOne({ _id: "global" }, { $set: { ...patch, updatedAt: new Date() } });
  return load();
}
