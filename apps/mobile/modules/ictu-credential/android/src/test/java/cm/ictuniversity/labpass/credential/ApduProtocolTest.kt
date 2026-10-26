package cm.ictuniversity.labpass.credential

import java.io.File
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Runs the shared tap-protocol vectors (packages/contracts/tap-protocol/vectors.json) against the Kotlin implementation. */
class ApduProtocolTest {
  private val vectors: JSONObject by lazy {
    var dir: File? = File("").absoluteFile
    while (dir != null && !File(dir, "packages/contracts/tap-protocol/vectors.json").exists()) dir = dir.parentFile
    JSONObject(File(dir!!, "packages/contracts/tap-protocol/vectors.json").readText())
  }
  private fun b64u(s: String) = Base64.getUrlDecoder().decode(s)
  private val ids get() = vectors.getJSONObject("ids")
  private val apdu get() = vectors.getJSONObject("apdu")

  @Test fun selectIsRecognisedAndAnsweredWithTheCredentialId() {
    assertEquals(ApduProtocol.Command.Select, ApduProtocol.parse(ApduProtocol.hex(apdu.getString("select"))))
    val resp = ApduProtocol.selectResponse(UUID.fromString(ids.getString("credentialId")))
    assertEquals(apdu.getString("selectResponse"), ApduProtocol.toHex(resp))
    assertEquals(apdu.getString("selectResponseNotEnrolled"), ApduProtocol.toHex(ApduProtocol.selectResponse(null)))
  }

  @Test fun signCommandIsParsedExactly() {
    val cmd = ApduProtocol.parse(ApduProtocol.hex(apdu.getString("sign"))) as ApduProtocol.Command.Sign
    assertEquals(UUID.fromString(ids.getString("kioskId")), cmd.kioskId)
    val sig = vectors.getJSONArray("signatures").getJSONObject(0)
    assertArrayEquals(b64u(sig.getString("nonce")), cmd.nonce)
    assertEquals(sig.getLong("ts"), cmd.ts)
  }

  @Test fun vectorSignaturesVerifyOverTheKotlinMessage() {
    val keys = vectors.getJSONObject("keys")
    val sigs = vectors.getJSONArray("signatures")
    for (i in 0 until sigs.length()) {
      val v = sigs.getJSONObject(i)
      if (v.getString("type") != "HCE") continue
      val pub = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(b64u(keys.getJSONObject(v.getString("key")).getString("spki"))))
      val msg = ApduProtocol.hceMessage(
        UUID.fromString(v.getString("credentialId")),
        b64u(v.getString("nonce")),
        UUID.fromString(ids.getString("kioskId")),
        v.getLong("ts"),
      )
      val ok = Signature.getInstance("SHA256withECDSA").run {
        initVerify(pub)
        update(msg)
        verify(b64u(v.getString("signature")))
      }
      assertEquals(v.getString("name"), v.getBoolean("expect"), ok)
    }
  }

  @Test fun malformedCommandsReturnStatusWords() {
    assertTrue(ApduProtocol.parse(byteArrayOf(0x00, 0xA4.toByte())) is ApduProtocol.Command.Error)
    assertEquals(ApduProtocol.Command.Error(ApduProtocol.SW_CLA_NOT_SUPPORTED), ApduProtocol.parse(ApduProtocol.hex("A0A4040000")))
    assertEquals(ApduProtocol.Command.Error(ApduProtocol.SW_INS_NOT_SUPPORTED), ApduProtocol.parse(ApduProtocol.hex("8020000000")))
    assertEquals(ApduProtocol.Command.Error(ApduProtocol.SW_FILE_NOT_FOUND), ApduProtocol.parse(ApduProtocol.hex("00A4040008A000000003101001")))
  }
}
