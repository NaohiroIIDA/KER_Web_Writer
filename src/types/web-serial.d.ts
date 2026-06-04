interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

type SerialParityType = 'none' | 'even' | 'odd'
type SerialFlowControlType = 'none' | 'hardware'

interface SerialOptions {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: SerialParityType
  bufferSize?: number
  flowControl?: SerialFlowControlType
}

interface SerialPort {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
  setSignals(signals: {
    dataTerminalReady?: boolean
    requestToSend?: boolean
    break?: boolean
  }): Promise<void>
}

interface Serial {
  getPorts(): Promise<SerialPort[]>
  requestPort(options?: unknown): Promise<SerialPort>
}

interface Navigator {
  serial: Serial
}
