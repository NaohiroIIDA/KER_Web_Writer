import { useEffect, useMemo, useState } from 'react'
import {
  TINY1616_FUSE_MAP,
  validateFuseValues,
} from './constants/fuses'
import { parseIntelHex, type ParsedHex } from './lib/hex'
import { SerialPortService } from './lib/serial'
import { Tiny1616Programmer } from './lib/tiny1616Programmer'
import './App.css'

type FirmwareOption = {
  name: string
  source: string
  parsed: ParsedHex
}

const firmwareModules = import.meta.glob('../firmware/*.hex', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const firmwareCatalog: FirmwareOption[] = Object.entries(firmwareModules)
  .map(([path, source]) => {
    const name = path.split('/').pop() ?? path
    return {
      name,
      source,
      parsed: parseIntelHex(source),
    }
  })
  .sort((left, right) => left.name.localeCompare(right.name, 'ja'))

function toHexString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

function getLogLineClass(entry: string): string {
  const normalized = entry.toLowerCase()

  if (normalized.includes('failed') || normalized.includes('blocked')) {
    return 'log-line log-line-error'
  }

  if (normalized.includes('completed') || normalized.includes('verified')) {
    return 'log-line log-line-success'
  }

  if (normalized.includes('erasing chip')) {
    return 'log-line log-line-erase'
  }

  if (normalized.includes('writing page') || normalized.includes('writing fuse')) {
    return 'log-line log-line-write'
  }

  if (normalized.includes('verifying page')) {
    return 'log-line log-line-verify'
  }

  return 'log-line'
}

function App() {
  const serial = useMemo(() => new SerialPortService(), [])
  const programmer = useMemo(() => new Tiny1616Programmer(serial), [serial])

  const [logs, setLogs] = useState<string[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [selectedFirmwareName, setSelectedFirmwareName] = useState<string>('')
  const [baudRate, setBaudRate] = useState<number>(57600)

  const activeHex = useMemo(
    () => firmwareCatalog.find((entry) => entry.name === selectedFirmwareName) ?? null,
    [selectedFirmwareName],
  )
  const fuseCheck = useMemo(() => validateFuseValues(TINY1616_FUSE_MAP), [])
  const statusLabel = isBusy ? 'Working' : isConnected ? 'Raw Serial Open' : 'Ready'
  const statusClassName = isBusy
    ? 'chip chip-busy'
    : isConnected
      ? 'chip chip-ok'
      : 'chip chip-idle'

  const appendLog = (message: string): void => {
    const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false })
    setLogs((current) => [`[${timestamp}] ${message}`, ...current].slice(0, 300))
  }

  useEffect(() => {
    return () => {
      void serial.close()
    }
  }, [serial])

  const connect = async (): Promise<void> => {
    try {
      setIsBusy(true)
      await serial.requestAndOpen(
        {
          baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          flowControl: 'none',
        },
        {
          onData: (chunk) => appendLog(`RX ${toHexString(chunk)}`),
          onDisconnect: () => {
            setIsConnected(false)
            appendLog('Port disconnected')
          },
        },
      )

      const info = serial.portInfo
      appendLog(
        `Connected VID=${info?.usbVendorId?.toString(16) ?? 'n/a'} PID=${info?.usbProductId?.toString(16) ?? 'n/a'}`,
      )
      setIsConnected(true)
    } catch (error) {
      appendLog(`Connect failed: ${(error as Error).message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const reconnect = async (): Promise<void> => {
    try {
      setIsBusy(true)
      const connected = await serial.reconnectGranted(
        {
          baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          flowControl: 'none',
        },
        {
          onData: (chunk) => appendLog(`RX ${toHexString(chunk)}`),
          onDisconnect: () => {
            setIsConnected(false)
            appendLog('Port disconnected')
          },
        },
      )

      if (!connected) {
        appendLog('No previously granted serial ports found')
        return
      }

      setIsConnected(true)
      appendLog('Reconnected to previously granted port')
    } catch (error) {
      appendLog(`Reconnect failed: ${(error as Error).message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    try {
      setIsBusy(true)
      await serial.close()
      setIsConnected(false)
      appendLog('Port closed')
    } catch (error) {
      appendLog(`Disconnect failed: ${(error as Error).message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const onFirmwareSelected = (name: string): void => {
    setSelectedFirmwareName(name)
    if (!name) {
      return
    }

    const selected = firmwareCatalog.find((entry) => entry.name === name)
    if (selected) {
      appendLog(`HEX selected: ${selected.name} (${selected.parsed.dataBytes} bytes)`)
    }
  }

  const writeFlash = async (): Promise<void> => {
    if (!activeHex) {
      appendLog('Write blocked: no HEX selected')
      return
    }

    try {
      setIsBusy(true)
      if (isConnected) {
        await serial.close()
        setIsConnected(false)
        appendLog('Raw serial session closed before UPDI programming')
      }
      await programmer.writeFlashFromHexSource(activeHex.source, (event) =>
        appendLog(`${event.step} (${event.percent}%)`),
      )
      appendLog('Flash write completed')
    } catch (error) {
      appendLog(`Write failed: ${(error as Error).message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const writeFuses = async (): Promise<void> => {
    try {
      setIsBusy(true)
      if (isConnected) {
        await serial.close()
        setIsConnected(false)
        appendLog('Raw serial session closed before UPDI programming')
      }
      await programmer.writeFixedFuses((event) => appendLog(`${event.step} (${event.percent}%)`))
      appendLog('Fuse write completed')
    } catch (error) {
      appendLog(`Fuse write failed: ${(error as Error).message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const verifyFlash = async (): Promise<void> => {
    if (!activeHex) {
      appendLog('Verify blocked: no HEX selected')
      return
    }

    try {
      setIsBusy(true)
      if (isConnected) {
        await serial.close()
        setIsConnected(false)
        appendLog('Raw serial session closed before UPDI programming')
      }
      await programmer.verifyFlashFromHexSource(activeHex.source, (event) =>
        appendLog(`${event.step} (${event.percent}%)`),
      )
      appendLog('Verify completed')
    } catch (error) {
      appendLog(`Verify failed: ${(error as Error).message}`)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>KER Writer on Web</h1>
          <p>Chrome + Web Serial / AVR Tiny1616 only</p>
        </div>
        <span className={statusClassName}>{statusLabel}</span>
      </header>

      <section className="layout-grid">
        <article className="panel">
          <h2>Connection</h2>
          <label htmlFor="baud">Baud rate</label>
          <input
            id="baud"
            type="number"
            value={baudRate}
            onChange={(event) => setBaudRate(Number(event.target.value || 57600))}
            min={300}
            step={300}
            disabled={isBusy}
          />

          <div className="button-row">
            <button type="button" onClick={connect} disabled={isBusy}>
              Connect
            </button>
            <button type="button" onClick={reconnect} disabled={isBusy}>
              Reconnect
            </button>
            <button type="button" onClick={disconnect} disabled={isBusy || !isConnected}>
              Disconnect
            </button>
          </div>
        </article>

        <article className="panel">
          <h2>Flash / Fuse</h2>
          <label htmlFor="firmware-select">Firmware</label>
          <select
            id="firmware-select"
            value={selectedFirmwareName}
            onChange={(event) => onFirmwareSelected(event.target.value)}
            disabled={isBusy}
          >
            <option value="">Select firmware</option>
            {firmwareCatalog.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>

          {activeHex ? (
            <p className="help">Selected: {activeHex.name} ({activeHex.parsed.dataBytes} bytes)</p>
          ) : (
            <p className="help">No firmware selected.</p>
          )}

          <div className="button-row">
            <button type="button" onClick={writeFlash} disabled={isBusy || !activeHex}>
              Write Flash
            </button>
            <button type="button" onClick={verifyFlash} disabled={isBusy || !activeHex}>
              Verify
            </button>
          </div>

          <button type="button" onClick={writeFuses} disabled={isBusy || !fuseCheck.ok}>
            Write Fixed Fuses
          </button>
        </article>

        <article className="panel">
          <h2>Execution Log</h2>
          <p className="help">Newest entries are shown at the top.</p>
          <div className="log-view">
            {logs.length === 0 ? (
              <p className="help">No logs yet.</p>
            ) : (
              logs.map((entry, index) => (
                <p key={`${entry}-${index}`} className={getLogLineClass(entry)}>
                  {entry}
                </p>
              ))
            )}
          </div>
        </article>
      </section>

      <footer className="footnote">
        <p>Tiny1616 only. Non-target devices and unsafe fuse edits are blocked by policy.</p>
      </footer>
    </main>
  )
}

export default App
