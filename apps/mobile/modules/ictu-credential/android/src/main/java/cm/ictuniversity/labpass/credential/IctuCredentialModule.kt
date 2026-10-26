package cm.ictuniversity.labpass.credential

import android.app.Activity
import android.content.ComponentName
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

private fun b64url(b: ByteArray): String = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
private fun fromB64url(s: String): ByteArray = Base64.decode(s, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

/** JS API for the LabPass Android app (Expo Modules). Keys never leave the Keystore; JS only sees public data. */
class IctuCredentialModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("IctuCredential")
    Events("onTap")

    OnCreate { TapEvents.listener = { kind -> sendEvent("onTap", mapOf("kind" to kind)) } }
    OnDestroy { TapEvents.listener = null }

    AsyncFunction("createKey") { attestationChallengeB64: String? ->
      val created = DeviceKey.create(context, attestationChallengeB64?.let(::fromB64url))
      mapOf(
        "spki" to b64url(created.spki),
        "attestation" to created.attestation.map(::b64url),
        "strongBox" to created.strongBox,
      )
    }

    Function("hasKey") { DeviceKey.exists() }

    AsyncFunction("signPop") { sessionId: String, popNonceB64: String ->
      b64url(DeviceKey.sign(ApduProtocol.popMessage(UUID.fromString(sessionId), fromB64url(popNonceB64))))
    }

    AsyncFunction("signScan") { credentialId: String, kioskId: String, nonceB64: String, ts: Double ->
      val msg = ApduProtocol.scanMessage(UUID.fromString(credentialId), fromB64url(nonceB64), UUID.fromString(kioskId), ts.toLong())
      b64url(DeviceKey.sign(msg))
    }

    Function("setActiveCredential") { id: String? -> DeviceKey.setActiveCredential(context, id) }

    Function("deleteKey") { DeviceKey.delete(context) }

    Function("nfcStatus") {
      val adapter = NfcAdapter.getDefaultAdapter(context)
      mapOf("present" to (adapter != null), "enabled" to (adapter?.isEnabled == true))
    }

    /** While the Pass screen is open, prefer LabPass for the AID even if another wallet claims "other" AIDs. */
    Function("setPreferred") { enabled: Boolean ->
      val activity: Activity = appContext.currentActivity ?: return@Function false
      val adapter = NfcAdapter.getDefaultAdapter(context) ?: return@Function false
      val emulation = CardEmulation.getInstance(adapter)
      val component = ComponentName(context, LabPassHceService::class.java)
      if (enabled) emulation.setPreferredService(activity, component) else emulation.unsetPreferredService(activity)
    }
  }
}
