// ============================================================
// kb-loader.ts — Lazy-loads YAML knowledge-base files
// All fetches are relative to /knowledge_base/ on the PWA origin.
// ============================================================

import * as yaml from 'js-yaml'

export interface KnowledgeBase {
  patterns: unknown
  nicRules: unknown
  driverRules: unknown
  licenseRules: unknown
  compatibility: unknown
}

let _cached: KnowledgeBase | null = null

export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
  if (_cached) return _cached

  // Resolve relative to worker bundle (works with any VITE_BASE / subpath deploy)
  const BASE = new URL('../knowledge_base/', import.meta.url).href

  const [patterns, nicRules, driverRules, licenseRules, compatibility] = await Promise.all([
    fetchYaml(BASE + 'patterns.yaml'),
    fetchYaml(BASE + 'nic_rules.yaml'),
    fetchYaml(BASE + 'driver_rules.yaml'),
    fetchYaml(BASE + 'license_rules.yaml'),
    fetchYaml(BASE + 'compatibility.yaml'),
  ])

  _cached = { patterns, nicRules, driverRules, licenseRules, compatibility }
  return _cached
}

async function fetchYaml(url: string): Promise<unknown> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`)
  const text = await resp.text()
  return yaml.load(text)
}
