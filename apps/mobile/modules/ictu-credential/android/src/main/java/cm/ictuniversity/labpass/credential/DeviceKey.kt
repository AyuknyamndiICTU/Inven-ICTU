package cm.ictuniversity.labpass.credential

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID

/**
 * Non-exportable P-256 device key in the Android Keystore (StrongBox when available, TEE otherwise), usable only
 * while the device is unlocked (ARCH §6). The active credentialId lives in app-private SharedPreferences so the
 * headless HCE service can answer SELECT without starting React Native.
 */
object DeviceKey {
  private const val ALIAS = "labpass-device-key-v1"
  private const val PREFS = "labpass-credential"
  private const val KEY_CREDENTIAL = "credentialId"

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  data class Created(val spki: ByteArray, val attestation: List<ByteArray>, val strongBox: Boolean)

  fun create(context: Context, challenge: ByteArray?): Created {
    val ks = keyStore()
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
    val strongBox = Build.VERSION.SDK_INT >= 28 &&
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
    fun spec(useStrongBox: Boolean): KeyGenParameterSpec {
      val b = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
      if (Build.VERSION.SDK_INT >= 28) {
        b.setUnlockedDeviceRequired(true)
        if (useStrongBox) b.setIsStrongBoxBacked(true)
      }
      if (challenge != null) b.setAttestationChallenge(challenge)
      return b.build()
    }
    val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val usedStrongBox = try {
      gen.initialize(spec(strongBox))
      gen.generateKeyPair()
      strongBox
    } catch (e: StrongBoxUnavailableException) {
      gen.initialize(spec(false))
      gen.generateKeyPair()
      false
    }
    val chain = keyStore().getCertificateChain(ALIAS)?.map { it.encoded } ?: emptyList()
    val spki = keyStore().getCertificate(ALIAS).publicKey.encoded
    return Created(spki, chain, usedStrongBox)
  }

  fun exists(): Boolean = keyStore().containsAlias(ALIAS)

  /** ECDSA-SHA256, DER-encoded — the format the server verifies (`dsaEncoding: 'der'`). */
  fun sign(message: ByteArray): ByteArray {
    val key = keyStore().getKey(ALIAS, null) as? PrivateKey ?: throw IllegalStateException("No device key")
    return Signature.getInstance("SHA256withECDSA").run {
      initSign(key)
      update(message)
      sign()
    }
  }

  fun delete(context: Context) {
    val ks = keyStore()
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
    setActiveCredential(context, null)
  }

  fun setActiveCredential(context: Context, id: String?) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
      if (id == null) remove(KEY_CREDENTIAL) else putString(KEY_CREDENTIAL, UUID.fromString(id).toString())
    }.apply()
  }

  fun activeCredential(context: Context): UUID? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CREDENTIAL, null)?.let(UUID::fromString)
}
