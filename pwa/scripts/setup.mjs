/**
 * setup.mjs — copies knowledge_base YAMLs and standalone icon into public/
 * Run before `vite dev` or `vite build` (already wired into `dev` and `build` scripts).
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')         // pwa/
const repoRoot = join(root, '..')      // t.SicView/

// ---- Knowledge base YAMLs ----
const kbSrc = join(repoRoot, 'knowledge_base')
const kbDest = join(root, 'public', 'knowledge_base')
mkdirSync(kbDest, { recursive: true })

for (const file of readdirSync(kbSrc)) {
  if (file.endsWith('.yaml')) {
    copyFileSync(join(kbSrc, file), join(kbDest, file))
    console.log(`  kb: ${file}`)
  }
}

// ---- App icon ----
const iconDir = join(root, 'public', 'icons')
mkdirSync(iconDir, { recursive: true })

const iconSources = [
  [join(repoRoot, 'standalone', 'assets', 'icon.ico'), join(iconDir, 'trilion-web.ico')],
]
for (const [src, dest] of iconSources) {
  if (existsSync(src)) {
    copyFileSync(src, dest)
    console.log(`  icon: ${src}`)
  }
}

console.log('setup done.')
