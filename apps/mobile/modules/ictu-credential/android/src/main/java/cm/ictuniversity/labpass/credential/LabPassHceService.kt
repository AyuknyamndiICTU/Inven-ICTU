package cm.ictuniversity.labpass.credential

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import java.util.concurrent.Executors

/**
 * Headless HCE service (ARCH §2/§6). Android routes APDUs for AID F0494354554C5001 here only while the phone is
 * unlocked (`requireDeviceUnlock="true"` in apduservice.xml). It never touches JavaScript: SELECT is answered from
 * native storage, SIGN is computed on a worker thread and returned with sendResponseApdu.
 */
class LabPassHceService : HostApduService() {
  private val worker = Executors.newSingleThreadExecutor()

  override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray? {
    return when (val cmd = ApduProtocol.parse(apdu)) {
      is ApduProtocol.Command.Select -> ApduProtocol.selectResponse(DeviceKey.activeCredential(applicationContext))
      is ApduProtocol.Command.Sign -> {
        val credential = DeviceKey.activeCredential(applicationContext)
          ?: return ApduProtocol.sw(ApduProtocol.SW_FILE_NOT_FOUND)
        worker.execute {
          val response = try {
            val msg = ApduProtocol.hceMessage(credential, cmd.nonce, cmd.kioskId, cmd.ts)
            ApduProtocol.signResponse(DeviceKey.sign(msg))
          } catch (e: Exception) {
            // Locked keystore, missing key, etc.: refuse rather than leak details.
            ApduProtocol.sw(ApduProtocol.SW_SECURITY_NOT_SATISFIED)
          }
          sendResponseApdu(response)
          TapEvents.emit("signed")
        }
        null
      }
      is ApduProtocol.Command.Error -> ApduProtocol.sw(cmd.sw)
    }
  }

  override fun onDeactivated(reason: Int) {
    TapEvents.emit("deactivated")
  }

  override fun onDestroy() {
    worker.shutdown()
    super.onDestroy()
  }
}

/** Optional bridge so the Pass screen can animate when a tap happens while the app is in the foreground. */
object TapEvents {
  @Volatile var listener: ((String) -> Unit)? = null
  fun emit(kind: String) {
    try {
      listener?.invoke(kind)
    } catch (_: Exception) {
    }
  }
}
