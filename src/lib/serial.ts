export type SerialCallbacks = {
  onData?: (chunk: Uint8Array) => void
  onDisconnect?: () => void
}

export class SerialPortService {
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private readLoopActive = false

  private static hasWebSerial(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator
  }

  get isOpen(): boolean {
    return this.port !== null && this.port.readable !== null && this.port.writable !== null
  }

  get portInfo(): SerialPortInfo | null {
    if (!this.port) {
      return null
    }
    return this.port.getInfo()
  }

  async requestAndOpen(options: SerialOptions, callbacks: SerialCallbacks = {}): Promise<void> {
    if (!SerialPortService.hasWebSerial()) {
      throw new Error('Web Serial API is not available in this browser')
    }

    this.port = await navigator.serial.requestPort()
    await this.openPort(options, callbacks)
  }

  async reconnectGranted(options: SerialOptions, callbacks: SerialCallbacks = {}): Promise<boolean> {
    if (!SerialPortService.hasWebSerial()) {
      throw new Error('Web Serial API is not available in this browser')
    }

    const ports = await navigator.serial.getPorts()
    if (ports.length === 0) {
      return false
    }

    this.port = ports[0]
    await this.openPort(options, callbacks)
    return true
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) {
      throw new Error('Serial port is not open')
    }

    const writer = this.port.writable.getWriter()
    try {
      await writer.write(data)
    } finally {
      writer.releaseLock()
    }
  }

  async close(): Promise<void> {
    this.readLoopActive = false

    const activeReader = this.reader
    if (activeReader) {
      await activeReader.cancel().catch(() => undefined)
      activeReader.releaseLock()
      this.reader = null
    }

    if (this.port) {
      await this.port.close().catch(() => undefined)
      this.port = null
    }
  }

  private async openPort(options: SerialOptions, callbacks: SerialCallbacks): Promise<void> {
    if (!this.port) {
      throw new Error('No serial port selected')
    }

    await this.port.open(options)
    this.readLoopActive = true
    this.startReadLoop(callbacks)
  }

  private async startReadLoop(callbacks: SerialCallbacks): Promise<void> {
    if (!this.port?.readable) {
      return
    }

    while (this.readLoopActive && this.port?.readable) {
      this.reader = this.port.readable.getReader()
      const activeReader = this.reader
      try {
        while (this.readLoopActive) {
          const { value, done } = await activeReader.read()
          if (done) {
            break
          }
          if (value && callbacks.onData) {
            callbacks.onData(value)
          }
        }
      } catch {
        // Ignore transient read errors and let the outer loop retry.
      } finally {
        activeReader.releaseLock()
        this.reader = null
      }
    }

    if (callbacks.onDisconnect) {
      callbacks.onDisconnect()
    }
  }
}
