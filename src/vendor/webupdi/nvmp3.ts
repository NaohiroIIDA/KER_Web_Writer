// @ts-nocheck
/**
 * NVM controller implementation for P:3.
 * Present on, for example, AVR EA
 */

import { NvmUpdi } from "./nvm.js";
import { UpdiReadWrite } from "./readwrite.js";
import { Timeout } from "./timeout.js";

/**
 * Version P:3 UPDI NVM properties
 */
export class NvmUpdiP3 extends NvmUpdi {
  // NVM CTRL peripheral definition
  static readonly NVMCTRL_CTRLA = 0x00;
  static readonly NVMCTRL_CTRLB = 0x01;
  static readonly NVMCTRL_INTCTRL = 0x04;
  static readonly NVMCTRL_INTFLAGS = 0x05;
  static readonly NVMCTRL_STATUS = 0x06;
  static readonly NVMCTRL_DATA = 0x08; // 16-bit
  static readonly NVMCTRL_ADDR = 0x0c; // 24-bit

  // CTRLA commands
  static readonly NVMCMD_NOCMD = 0x00;
  static readonly NVMCMD_NOOP = 0x01;
  static readonly NVMCMD_FLASH_PAGE_WRITE = 0x04;
  static readonly NVMCMD_FLASH_PAGE_ERASE_WRITE = 0x05;
  static readonly NVMCMD_FLASH_PAGE_ERASE = 0x08;
  static readonly NVMCMD_FLASH_PAGE_BUFFER_CLEAR = 0x0f;
  static readonly NVMCMD_EEPROM_PAGE_WRITE = 0x14;
  static readonly NVMCMD_EEPROM_PAGE_ERASE_WRITE = 0x15;
  static readonly NVMCMD_EEPROM_PAGE_ERASE = 0x17;
  static readonly NVMCMD_EEPROM_PAGE_BUFFER_CLEAR = 0x1f;
  static readonly NVMCMD_CHIP_ERASE = 0x20;
  static readonly NVMCMD_EEPROM_ERASE = 0x30;

  // STATUS
  static readonly STATUS_WRITE_ERROR_bm = 0x70;
  static readonly STATUS_WRITE_ERROR_bp = 4;
  static readonly STATUS_EEPROM_BUSY_bp = 0;
  static readonly STATUS_FLASH_BUSY_bp = 1;

  constructor(readwrite: UpdiReadWrite, device?: any) {
    super(readwrite, device);
  }

  async chipErase(): Promise<void> {
    if (!await this.waitNvmReady()) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready before chip erase"
      );
    }

    await this.executeNvmCommand(NvmUpdiP3.NVMCMD_CHIP_ERASE);
    const status = await this.waitNvmReady();

    // Remove command
    await this.executeNvmCommand(NvmUpdiP3.NVMCMD_NOCMD);

    if (!status) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready after chip erase"
      );
    }
  }

  async eraseFlashPage(address: number): Promise<void> {
    if (!await this.waitNvmReady()) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready before flash page erase"
      );
    }

    await this.readwrite.writeData(address, new Uint8Array([0xff]));
    await this.executeNvmCommand(NvmUpdiP3.NVMCMD_FLASH_PAGE_ERASE);
    const status = await this.waitNvmReady();

    // Remove command
    await this.executeNvmCommand(NvmUpdiP3.NVMCMD_NOCMD);

    if (!status) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready after flash page erase"
      );
    }
  }

  async eraseEeprom(): Promise<void> {
    if (!await this.waitNvmReady()) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready before EEPROM erase"
      );
    }

    await this.executeNvmCommand(NvmUpdiP3.NVMCMD_EEPROM_ERASE);
    const status = await this.waitNvmReady();

    // Remove command
    await this.executeNvmCommand(NvmUpdiP3.NVMCMD_NOCMD);

    if (!status) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready after EEPROM erase"
      );
    }
  }

  async eraseUserRow(address: number, size?: number): Promise<void> {
    // On this NVM version user row is implemented as FLASH
    await this.eraseFlashPage(address);
  }

  async writeFlash(address: number, data: Uint8Array): Promise<void> {
    await this.writeNvm(
      address,
      data,
      true,
      NvmUpdiP3.NVMCMD_FLASH_PAGE_WRITE,
      NvmUpdiP3.NVMCMD_FLASH_PAGE_BUFFER_CLEAR
    );
  }

  async writeUserRow(address: number, data: Uint8Array): Promise<void> {
    // On this NVM variant user row is implemented as FLASH
    await this.writeNvm(
      address,
      data,
      true,
      NvmUpdiP3.NVMCMD_FLASH_PAGE_WRITE,
      NvmUpdiP3.NVMCMD_FLASH_PAGE_BUFFER_CLEAR
    );
  }

  async writeEeprom(address: number, data: Uint8Array): Promise<void> {
    await this.writeNvm(
      address,
      data,
      false,
      NvmUpdiP3.NVMCMD_EEPROM_PAGE_ERASE_WRITE,
      NvmUpdiP3.NVMCMD_EEPROM_PAGE_BUFFER_CLEAR
    );
  }

  async writeFuse(address: number, data: Uint8Array): Promise<void> {
    await this.writeEeprom(address, data);
  }

  private async writeNvm(
    address: number,
    data: Uint8Array,
    useWordAccess: boolean,
    nvmcommand: number = NvmUpdiP3.NVMCMD_FLASH_PAGE_WRITE,
    erasebufferCommand: number = NvmUpdiP3.NVMCMD_FLASH_PAGE_BUFFER_CLEAR
  ): Promise<void> {
    if (!await this.waitNvmReady()) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready before page buffer clear"
      );
    }

    // Clear the page buffer
    await this.executeNvmCommand(erasebufferCommand);

    if (!await this.waitNvmReady()) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready after page buffer clear"
      );
    }

    // Load the page buffer by writing directly to location
    if (useWordAccess) {
      await this.readwrite.writeDataWords(address, data);
    } else {
      await this.readwrite.writeData(address, data);
    }

    // Write the page to NVM, maybe erase first
    await this.executeNvmCommand(nvmcommand);

    if (!await this.waitNvmReady()) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready after page write"
      );
    }

    // Remove command
    await this.executeNvmCommand(NvmUpdiP3.NVMCMD_NOCMD);
  }

  private async waitNvmReady(timeoutMs: number = 100): Promise<boolean> {
    const timeout = new Timeout(timeoutMs);

    while (!timeout.expired()) {
      const status = await this.readwrite.readByte(
        this.device.nvmctrlAddress + NvmUpdiP3.NVMCTRL_STATUS
      );
      if (status & NvmUpdiP3.STATUS_WRITE_ERROR_bm) {
        throw new Error(
          `NVM error (${status >> NvmUpdiP3.STATUS_WRITE_ERROR_bp})`
        );
      }

      if (
        !(
          status &
          ((1 << NvmUpdiP3.STATUS_EEPROM_BUSY_bp) |
            (1 << NvmUpdiP3.STATUS_FLASH_BUSY_bp))
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private async executeNvmCommand(command: number): Promise<void> {
    await this.readwrite.writeByte(
      this.device.nvmctrlAddress + NvmUpdiP3.NVMCTRL_CTRLA,
      command
    );
  }
}
