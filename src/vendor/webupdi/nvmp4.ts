// @ts-nocheck
/**
 * NVM controller implementation for P:4.
 * Present on, for example, AVR DU
 */

import { NvmUpdi } from "./nvm.js";
import { UpdiReadWrite } from "./readwrite.js";
import { Timeout } from "./timeout.js";

/**
 * Version P:4 UPDI NVM properties
 */
export class NvmUpdiP4 extends NvmUpdi {
  // NVM CTRL peripheral definition
  static readonly NVMCTRL_CTRLA = 0x00;
  static readonly NVMCTRL_CTRLB = 0x01;
  static readonly NVMCTRL_CTRLC = 0x02;
  static readonly NVMCTRL_INTCTRL = 0x04;
  static readonly NVMCTRL_INTFLAGS = 0x05;
  static readonly NVMCTRL_STATUS = 0x06;
  static readonly NVMCTRL_DATA = 0x08; // 16-bit
  static readonly NVMCTRL_ADDR = 0x0c; // 24-bit

  // CTRLA commands
  static readonly NVMCMD_NOCMD = 0x00;
  static readonly NVMCMD_NOOP = 0x01;
  static readonly NVMCMD_FLASH_WRITE = 0x02;
  static readonly NVMCMD_FLASH_PAGE_ERASE = 0x08;
  static readonly NVMCMD_EEPROM_WRITE = 0x12;
  static readonly NVMCMD_EEPROM_ERASE_WRITE = 0x13;
  static readonly NVMCMD_EEPROM_BYTE_ERASE = 0x18;
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

    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_CHIP_ERASE);
    const status = await this.waitNvmReady();

    // Remove command from NVM controller
    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_NOCMD);
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

    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_FLASH_PAGE_ERASE);
    await this.readwrite.writeData(address, new Uint8Array([0xff]));
    const status = await this.waitNvmReady();

    // Remove command from NVM controller
    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_NOCMD);
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

    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_EEPROM_ERASE);
    const status = await this.waitNvmReady();

    // Remove command from NVM controller
    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_NOCMD);
    if (!status) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready after EEPROM erase"
      );
    }
  }

  async eraseUserRow(address: number, size?: number): Promise<void> {
    // On this NVM version user row is implemented as flash
    await this.eraseFlashPage(address);
  }

  async writeFlash(address: number, data: Uint8Array): Promise<void> {
    await this.writeNvm(address, data, true);
  }

  async writeUserRow(address: number, data: Uint8Array): Promise<void> {
    // On this NVM variant user row is implemented as Flash
    await this.writeNvm(address, data, false);
  }

  async writeEeprom(address: number, data: Uint8Array): Promise<void> {
    const nvmCommand = NvmUpdiP4.NVMCMD_EEPROM_ERASE_WRITE;

    if (!await this.waitNvmReady()) {
      throw new Error("Timeout waiting for NVM ready before command write");
    }

    // Write the command to the NVM controller
    await this.executeNvmCommand(nvmCommand);

    // Write the data
    await this.readwrite.writeData(address, data);

    // Wait for NVM controller to be ready again
    const status = await this.waitNvmReady();

    // Remove command from NVM controller
    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_NOCMD);

    if (!status) {
      throw new Error("Timeout waiting for NVM ready after data write");
    }
  }

  async writeFuse(address: number, data: Uint8Array): Promise<void> {
    // Fuses are EEPROM-based in this variant
    await this.writeEeprom(address, data);
  }

  private async writeNvm(
    address: number,
    data: Uint8Array,
    useWordAccess: boolean
  ): Promise<void> {
    const nvmCommand = NvmUpdiP4.NVMCMD_FLASH_WRITE;

    if (!await this.waitNvmReady()) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready before page buffer clear"
      );
    }

    // Write the command to the NVM controller
    await this.executeNvmCommand(nvmCommand);

    // Write the data
    if (useWordAccess) {
      await this.readwrite.writeDataWords(address, data);
    } else {
      await this.readwrite.writeData(address, data);
    }

    // Wait for NVM controller to be ready again
    const status = await this.waitNvmReady();

    // Remove command from NVM controller
    await this.executeNvmCommand(NvmUpdiP4.NVMCMD_NOCMD);
    if (!status) {
      throw new Error(
        "Timeout waiting for NVM controller to be ready after data write"
      );
    }
  }

  private async waitNvmReady(timeoutMs: number = 100): Promise<boolean> {
    const timeout = new Timeout(timeoutMs);

    while (!timeout.expired()) {
      const status = await this.readwrite.readByte(
        this.device.nvmctrlAddress + NvmUpdiP4.NVMCTRL_STATUS
      );
      if (status & NvmUpdiP4.STATUS_WRITE_ERROR_bm) {
        throw new Error(
          `NVM error (${status >> NvmUpdiP4.STATUS_WRITE_ERROR_bp})`
        );
      }

      if (
        !(
          status &
          ((1 << NvmUpdiP4.STATUS_EEPROM_BUSY_bp) |
            (1 << NvmUpdiP4.STATUS_FLASH_BUSY_bp))
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private async executeNvmCommand(command: number): Promise<void> {
    await this.readwrite.writeByte(
      this.device.nvmctrlAddress + NvmUpdiP4.NVMCTRL_CTRLA,
      command
    );
  }
}
