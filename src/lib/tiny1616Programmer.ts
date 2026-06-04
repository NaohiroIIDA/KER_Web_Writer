import {
  TINY1616_FUSE_MAP,
  TINY1616_FUSE_ORDER,
  type Tiny1616FuseName,
  formatFuseValue,
} from '../constants/fuses'
import { parseIntelHex, type ParsedHex } from './hex'
import { SerialPortService } from './serial'
import { UpdiApplication } from '../vendor/webupdi/application.js'
import { UPDI_DEVICES } from '../vendor/webupdi/devices.js'

export type ProgressEvent = {
  step: string
  percent: number
}

type VendorDeviceInfo = {
  device_id?: number
  flash_address?: number
  flash_size?: number
  flash_page_size?: number
  eeprom_address?: number
  eeprom_size?: number
}

type UpdiAppInternal = {
  nvm?: {
    writeFuse: (address: number, data: Uint8Array) => Promise<void>
  } | null
}

const TINY1616_DEVICE = UPDI_DEVICES.attiny1616 as VendorDeviceInfo
const NVMCTRL_ADDRESS = 0x1000
const SIGROW_ADDRESS = 0x1100
const FUSE_BASE = 0x1280
const UPDI_BAUD = 115200

export class Tiny1616Programmer {
  private readonly serial: SerialPortService

  constructor(serial: SerialPortService) {
    this.serial = serial
  }

  async runProbe(onProgress?: (event: ProgressEvent) => void): Promise<void> {
    onProgress?.({ step: 'Preparing probe', percent: 5 })

    if (!this.serial.isOpen) {
      throw new Error('Serial port is not open')
    }

    await this.serial.write(new Uint8Array([0x55]))
    onProgress?.({ step: 'Probe byte sent (0x55)', percent: 100 })
  }

  async writeFlash(hex: ParsedHex): Promise<void> {
    if (hex.dataBytes === 0) {
      throw new Error('HEX has no data bytes')
    }
    throw new Error('HEX source text is required for real UPDI flash write')
  }

  async writeFlashFromHexSource(
    hexSource: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<void> {
    const parsed = parseIntelHex(hexSource)
    await this.withConnectedApplication(onProgress, async (app) => {
      const pageSize = TINY1616_DEVICE.flash_page_size ?? 0x40
      const flashAddress = TINY1616_DEVICE.flash_address ?? 0x8000
      const flashSize = TINY1616_DEVICE.flash_size ?? 0x4000

      onProgress?.({ step: 'Erasing chip', percent: 20 })
      const totalFlashPages = flashSize / pageSize
      for (let index = 0; index < totalFlashPages; index += 1) {
        await this.withTimeout(
          app.eraseFlashPage(flashAddress + index * pageSize),
          3000,
          `Flash erase timeout at page ${index + 1}`,
        )
      }

      const pages = this.buildPages(parsed, flashAddress, pageSize)
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        await this.withTimeout(app.writeFlash(page.address, page.data), 5000, `Flash write timeout at page ${index + 1}`)
        const percent = 25 + Math.round(((index + 1) / pages.length) * 40)
        onProgress?.({ step: `Writing page ${index + 1}/${pages.length}`, percent })
      }

      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        const readBack = await this.withTimeout(
          app.readData(page.address, page.data.length),
          5000,
          `Flash verify timeout at page ${index + 1}`,
        )
        this.assertPageMatches(page.address, page.data, readBack)
        const percent = 70 + Math.round(((index + 1) / pages.length) * 30)
        onProgress?.({ step: `Verifying page ${index + 1}/${pages.length}`, percent })
      }
    })
  }

  async writeFixedFuses(onProgress?: (event: ProgressEvent) => void): Promise<void> {
    const printable = TINY1616_FUSE_ORDER.map((name) => `${name}=${formatFuseValue(TINY1616_FUSE_MAP[name])}`)
    onProgress?.({ step: `Applying fixed fuses: ${printable.join(', ')}`, percent: 10 })

    const syscfg0 = TINY1616_FUSE_MAP.fuse5
    const crcSrc = (syscfg0 >> 6) & 0b11
    if (crcSrc !== 0b11) {
      throw new Error('Blocked: fuse5 CRCSRC must stay 0b11')
    }

    await this.withConnectedApplication(onProgress, async (app) => {
      const internal = app as unknown as UpdiAppInternal
      if (!internal.nvm) {
        throw new Error('UPDI NVM driver is not initialized')
      }

      for (let index = 0; index < TINY1616_FUSE_ORDER.length; index += 1) {
        const fuseName = TINY1616_FUSE_ORDER[index]
        const fuseNumber = Number.parseInt(fuseName.replace('fuse', ''), 10)
        const fuseValue = TINY1616_FUSE_MAP[fuseName]
        await this.withTimeout(
          internal.nvm.writeFuse(FUSE_BASE + fuseNumber, new Uint8Array([fuseValue])),
          5000,
          `Fuse write timeout for ${fuseName}`,
        )
        const percent = 25 + Math.round(((index + 1) / TINY1616_FUSE_ORDER.length) * 45)
        onProgress?.({ step: `Writing ${fuseName}`, percent })
      }

      await this.verifyFuseReadback(app)
      onProgress?.({ step: 'Fuse readback verified', percent: 100 })
    })
  }

  async verifyFlash(hex: ParsedHex): Promise<void> {
    if (hex.dataBytes === 0) {
      throw new Error('HEX has no data bytes')
    }
    throw new Error('HEX source text is required for real UPDI verify')
  }

  async verifyFlashFromHexSource(
    hexSource: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<void> {
    const parsed = parseIntelHex(hexSource)
    await this.withConnectedApplication(onProgress, async (app) => {
      const pageSize = TINY1616_DEVICE.flash_page_size ?? 0x40
      const flashAddress = TINY1616_DEVICE.flash_address ?? 0x8000
      const pages = this.buildPages(parsed, flashAddress, pageSize)

      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index]
        const readBack = await this.withTimeout(
          app.readData(page.address, page.data.length),
          5000,
          `Flash verify timeout at page ${index + 1}`,
        )
        this.assertPageMatches(page.address, page.data, readBack)
        const percent = 20 + Math.round(((index + 1) / pages.length) * 80)
        onProgress?.({ step: `Verifying page ${index + 1}/${pages.length}`, percent })
      }
    })
  }

  getFixedFuses(): Record<Tiny1616FuseName, number> {
    return { ...TINY1616_FUSE_MAP }
  }

  private async withConnectedApplication(
    onProgress: ((event: ProgressEvent) => void) | undefined,
    task: (app: UpdiApplication) => Promise<void>,
  ): Promise<void> {
    const port = await this.getOrRequestPort()
    const app = new UpdiApplication(port, UPDI_BAUD, { nvmctrlAddress: NVMCTRL_ADDRESS }, 1000)

    try {
      onProgress?.({ step: 'Initializing UPDI transport', percent: 0 })
      await this.withTimeout(app.init(), 8000, 'UPDI init timeout')

      onProgress?.({ step: 'Reading device info', percent: 5 })
      await this.withTimeout(app.readDeviceInfo(), 8000, 'UPDI device info timeout')

      onProgress?.({ step: 'Entering programming mode', percent: 10 })
      await this.withTimeout(app.enterProgmode(), 5000, 'Enter programming mode timeout')

      await this.verifySignature(app)
      onProgress?.({ step: 'Verified Tiny1616 signature', percent: 15 })

      await task(app)

      onProgress?.({ step: 'Leaving programming mode', percent: 100 })
      await this.withTimeout(app.leaveProgmode(), 4000, 'Leave programming mode timeout')
    } finally {
      await port.close().catch(() => undefined)
    }
  }

  private async getOrRequestPort(): Promise<SerialPort> {
    const granted = await navigator.serial.getPorts()
    if (granted.length > 0) {
      return granted[0]
    }
    return navigator.serial.requestPort()
  }

  private async verifySignature(app: UpdiApplication): Promise<void> {
    const expected = TINY1616_DEVICE.device_id ?? 0x1e9421
    const primary = await this.withTimeout(app.readData(SIGROW_ADDRESS, 3), 4000, 'Signature read timeout')
    const actual = (primary[0] << 16) | (primary[1] << 8) | primary[2]
    if (actual === expected) {
      return
    }

    const fallback = await this.withTimeout(app.readData(0x1080, 3), 4000, 'Signature fallback read timeout')
    const fallbackValue = (fallback[0] << 16) | (fallback[1] << 8) | fallback[2]
    if (fallbackValue !== expected) {
      throw new Error(
        `Unexpected device signature: got 0x${actual.toString(16)} / 0x${fallbackValue.toString(16)}, expected 0x${expected.toString(16)}`,
      )
    }
  }

  private buildPages(
    parsed: ParsedHex,
    flashBaseAddress: number,
    pageSize: number,
  ): Array<{ address: number; data: Uint8Array }> {
    const pages: Array<{ address: number; data: Uint8Array }> = []
    const dataStartOffset = parsed.minAddress ?? 0

    for (let offset = 0; offset < parsed.binary.length; offset += pageSize) {
      const chunk = parsed.binary.slice(offset, Math.min(offset + pageSize, parsed.binary.length))
      const pageData = new Uint8Array(pageSize)
      pageData.fill(0xff)
      pageData.set(chunk, 0)
      pages.push({
        address: flashBaseAddress + dataStartOffset + offset,
        data: pageData,
      })
    }

    return pages
  }

  private assertPageMatches(address: number, expected: Uint8Array, actual: Uint8Array): void {
    for (let index = 0; index < expected.length; index += 1) {
      if (expected[index] !== actual[index]) {
        throw new Error(
          `Verification failed at address 0x${(address + index).toString(16).toUpperCase()}: expected ${formatFuseValue(expected[index])} got ${formatFuseValue(actual[index] ?? 0xff)}`,
        )
      }
    }
  }

  private async verifyFuseReadback(app: UpdiApplication): Promise<void> {
    for (const fuseName of TINY1616_FUSE_ORDER) {
      const fuseNumber = Number.parseInt(fuseName.replace('fuse', ''), 10)
      const expected = TINY1616_FUSE_MAP[fuseName]
      const actual = await this.withTimeout(app.readData(FUSE_BASE + fuseNumber, 1), 4000, `Fuse readback timeout for ${fuseName}`)
      if (actual[0] !== expected) {
        throw new Error(
          `Fuse readback mismatch ${fuseName}: expected ${formatFuseValue(expected)} got ${formatFuseValue(actual[0] ?? 0xff)}`,
        )
      }
    }
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
    })

    try {
      return await Promise.race([operation, timeoutPromise])
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }
}
