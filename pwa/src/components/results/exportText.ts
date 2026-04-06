import type { ParseResult } from '../../worker/models'

/** Build a plain-text diagnostic report and trigger a download. */
export function exportPlainText(result: ParseResult, filename: string) {
  const lines: string[] = []
  const hr = '='.repeat(72)
  const sr = '-'.repeat(72)

  const push = (s = '') => lines.push(s)
  const heading = (title: string) => { push(hr); push(title); push(hr) }
  const subheading = (title: string) => { push(sr); push(title); push(sr) }

  // Header
  heading('t.SicView — Diagnostic Report')
  push(`File:     ${result.archive_filename}`)
  push(`Parsed:   ${result.parsed_at}`)
  push(`Product:  ${result.product_type}`)
  if (result.detected_product) push(`Detected: ${result.detected_product}`)
  push()

  // Findings
  if (result.findings.length > 0) {
    heading('FINDINGS')
    for (const f of result.findings) {
      push(`[${f.severity}] ${f.title}`)
      push(`  ${f.description}`)
      if (f.recommendation) push(`  Recommendation: ${f.recommendation}`)
      if (f.source_file) push(`  Source: ${f.source_file}${f.source_line != null ? `:${f.source_line}` : ''}`)
      push()
    }
  }

  // ZEISS Versions
  if (result.zeiss_versions) {
    const v = result.zeiss_versions
    // Enrich quality_suite_version from drivers like SystemPanel does
    const zqsFromDrivers = result.drivers?.all_relevant_drivers.find(d =>
      /ZEISS\s+Quality\s+Suite/i.test(d.name),
    )?.version
    const qsv = zqsFromDrivers ?? v.quality_suite_version

    heading('ZEISS VERSIONS')
    if (v.inspect_version) push(`ZEISS INSPECT:      ${v.inspect_version}`)
    if (v.hardware_service_version) push(`Hardware Service:   ${v.hardware_service_version}`)
    if (qsv) push(`Quality Suite:      ${qsv}`)
    if (v.product_name) push(`Product Name:       ${v.product_name}`)
    push()
  }

  // System Info
  if (result.system_info) {
    const s = result.system_info
    heading('SYSTEM INFORMATION')
    const fields: [string, string | undefined][] = [
      ['Computer Name', s.computer_name],
      ['OS Name', s.os_name],
      ['OS Version', s.os_version],
      ['Processor', s.processor],
      ['Total Memory', s.total_physical_memory],
      ['BIOS Version', s.bios_version],
      ['Baseboard', s.baseboard_product],
      ['Manufacturer', s.system_manufacturer],
      ['Model', s.system_model],
    ]
    for (const [label, val] of fields) {
      if (val) push(`${label.padEnd(20)} ${val}`)
    }
    if (s.problem_devices.length > 0) {
      push()
      subheading(`Problem Devices (${s.problem_devices.length})`)
      for (const d of s.problem_devices) push(`  - ${d}`)
    }
    push()
  }

  // Licensing
  if (result.licensing) {
    heading('LICENSING')
    for (const d of result.licensing.dongles) {
      push(`Dongle${d.dongle_type ? ` (${d.dongle_type})` : ''}: ${d.serial ?? '—'}`)
    }
    if (result.licensing.licensed_products.length > 0) {
      push(`Licensed Products: ${result.licensing.licensed_products.join(', ')}`)
    }
    push()
  }

  // Network
  if (result.network) {
    heading('NETWORK')
    if (result.network.hostname) push(`Hostname: ${result.network.hostname}`)
    for (const a of result.network.adapters) {
      subheading(a.name)
      if (a.description) push(`  Description:   ${a.description}`)
      if (a.mac_address) push(`  MAC:           ${a.mac_address}`)
      if (a.ip_addresses.length) push(`  IP:            ${a.ip_addresses.join(', ')}`)
      if (a.default_gateway) push(`  Gateway:       ${a.default_gateway}`)
      if (a.link_speed) push(`  Link Speed:    ${a.link_speed}`)
      if (a.driver_name) push(`  Driver:        ${a.driver_name} ${a.driver_version ?? ''}`)
      push()
    }
  }

  // Drivers
  if (result.drivers) {
    heading('DRIVERS')
    const d = result.drivers
    if (d.nvidia_driver) push(`NVIDIA:     ${d.nvidia_driver}`)
    if (d.mellanox_driver) push(`Mellanox:   ${d.mellanox_driver}`)
    if (d.rivermax) push(`Rivermax:   ${d.rivermax}`)
    if (d.codemeter) push(`CodeMeter:  ${d.codemeter}`)
    if (d.gpu) {
      push()
      subheading('GPU')
      if (d.gpu.name) push(`  Name:           ${d.gpu.name}`)
      if (d.gpu.driver_version) push(`  Driver:         ${d.gpu.driver_version}`)
      if (d.gpu.memory_total) push(`  Memory Total:   ${d.gpu.memory_total}`)
    }
    if (d.all_relevant_drivers.length > 0) {
      push()
      subheading('Installed Software')
      for (const drv of d.all_relevant_drivers) {
        push(`  ${drv.name}${drv.version ? ` — ${drv.version}` : ''}${drv.publisher ? ` (${drv.publisher})` : ''}`)
      }
    }
    push()
  }

  // Hardware Service
  if (result.hardware_service) {
    const hs = result.hardware_service
    heading('HARDWARE SERVICE')
    if (hs.version) push(`Version:    ${hs.version}`)
    if (hs.hal_version) push(`HAL:        ${hs.hal_version}`)
    push(`Running:    ${hs.running ? 'Yes' : 'No'}`)
    if (hs.ports.length > 0) {
      push()
      subheading('Ports')
      for (const p of hs.ports) {
        push(`  ${p.port} ${p.protocol} — ${p.service} [${p.status}]`)
      }
    }
    if (hs.errors.length > 0) {
      push()
      subheading('Errors')
      for (const e of hs.errors) {
        push(`  [${e.severity ?? '?'}] ${e.description ?? e.error_code ?? '—'}`)
      }
    }
    push()
  }

  // Cameras
  if (result.cameras) {
    heading('CAMERAS')
    for (const c of result.cameras.cameras) {
      push(`${c.camera_name ?? c.model ?? 'Camera'}`)
      if (c.serial_number) push(`  Serial:  ${c.serial_number}`)
      if (c.ip_address) push(`  IP:      ${c.ip_address}`)
      if (c.mac_address) push(`  MAC:     ${c.mac_address}`)
      push()
    }
    if (result.cameras.controllers.length > 0) {
      subheading('Controllers')
      for (const ctrl of result.cameras.controllers) {
        push(`  ${ctrl.name ?? ctrl.device_type ?? 'Controller'} — FW: ${ctrl.firmware ?? '—'} — IP: ${ctrl.ip_address ?? '—'}`)
      }
      push()
    }
  }

  // Logs summary
  if (result.logs) {
    heading('LOGS SUMMARY')
    push(`Total Errors:   ${result.logs.total_errors}`)
    push(`Total Warnings: ${result.logs.total_warnings}`)
    push(`Files Analyzed: ${result.logs.files_analyzed.length}`)
    push()
  }

  // Disk Drives
  if (result.codemeter?.drives.length) {
    heading('DISK DRIVES')
    for (const drv of result.codemeter.drives) {
      const total = drv.total_mb != null ? (drv.total_mb / 1024).toFixed(1) : '?'
      const free = drv.free_mb != null ? (drv.free_mb / 1024).toFixed(1) : '?'
      push(`${drv.letter}: ${drv.label ?? ''} — ${free} GB free / ${total} GB total`)
    }
    push()
  }

  // USB
  if (result.usb && result.usb.devices.length > 0) {
    heading('USB DEVICES')
    for (const dev of result.usb.devices) {
      push(`  ${dev.name ?? dev.device_id ?? 'Unknown'}${dev.status && dev.status !== 'OK' ? ` [${dev.status}]` : ''}`)
    }
    push()
  }

  const text = lines.join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const baseName = filename.replace(/\.[^.]+$/, '')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}-report.txt`
  a.click()
  URL.revokeObjectURL(url)
}
