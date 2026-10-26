package cm.ictuniversity.labpass.credential

import java.nio.ByteBuffer
import java.util.UUID

/**
 * ICTU Tap Protocol v1, phone side (docs/protocols/tap-protocol-v1.md). Pure Kotlin with no Android types so JUnit
 * runs it against the shared vectors.json — the same vectors the TypeScript reference implementation uses.
 */
object ApduProtocol {
  const val TAP_VERSION: Byte = 1
  val AID: ByteArray = hex("F0494354554C5001")
  private const val CLA_ISO: Int = 0x00
  private const val CLA_PROPRIETARY: Int = 0x80
  private const val INS_SELECT: Int = 0xA4
  private const val INS_SIGN: Int = 0x10
  private const val SIGN_LC: Int = 40

  const val SW_OK = 0x9000
  const val SW_FILE_NOT_FOUND = 0x6A82
  const val SW_WRONG_LENGTH = 0x6700
  const val SW_INS_NOT_SUPPORTED = 0x6D00
  const val SW_CLA_NOT_SUPPORTED = 0x6E00
  const val SW_SECURITY_NOT_SATISFIED = 0x6982

  private const val PREFIX_HCE = "ICTU-LP1-HCE"
  private const val PREFIX_SCAN = "ICTU-LP1-SCAN"
  private const val PREFIX_POP = "ICTU-LP1-POP"

  sealed class Command {
    object Select : Command()
    data class Sign(val nonce: ByteArray, val kioskId: UUID, val ts: Long) : Command()
    data class Error(val sw: Int) : Command()
  }

  fun parse(apdu: ByteArray): Command {
    if (apdu.size < 4) return Command.Error(SW_WRONG_LENGTH)
    val cla = apdu[0].toInt() and 0xFF
    val ins = apdu[1].toInt() and 0xFF
    val p1 = apdu[2].toInt() and 0xFF
    val p2 = apdu[3].toInt() and 0xFF
    if (cla == CLA_ISO && ins == INS_SELECT) {
      if (p1 != 0x04 || p2 != 0x00 || apdu.size < 5) return Command.Error(SW_WRONG_LENGTH)
      val lc = apdu[4].toInt() and 0xFF
      if (apdu.size < 5 + lc) return Command.Error(SW_WRONG_LENGTH)
      return if (apdu.copyOfRange(5, 5 + lc).contentEquals(AID)) Command.Select else Command.Error(SW_FILE_NOT_FOUND)
    }
    if (cla == CLA_PROPRIETARY) {
      if (ins != INS_SIGN) return Command.Error(SW_INS_NOT_SUPPORTED)
      if (apdu.size != 5 + SIGN_LC + 1 || (apdu[4].toInt() and 0xFF) != SIGN_LC) return Command.Error(SW_WRONG_LENGTH)
      val body = apdu.copyOfRange(5, 5 + SIGN_LC)
      val buf = ByteBuffer.wrap(body, 16, 24)
      val kiosk = UUID(buf.long, buf.long)
      val ts = buf.long
      if (ts < 0) return Command.Error(SW_WRONG_LENGTH)
      return Command.Sign(body.copyOfRange(0, 16), kiosk, ts)
    }
    return Command.Error(SW_CLA_NOT_SUPPORTED)
  }

  fun selectResponse(credentialId: UUID?): ByteArray =
    if (credentialId == null) sw(SW_FILE_NOT_FOUND) else byteArrayOf(TAP_VERSION) + uuid(credentialId) + sw(SW_OK)

  fun signResponse(derSignature: ByteArray): ByteArray = derSignature + sw(SW_OK)

  fun sw(code: Int): ByteArray = byteArrayOf((code shr 8).toByte(), code.toByte())

  fun hceMessage(credentialId: UUID, nonce: ByteArray, kioskId: UUID, ts: Long): ByteArray =
    PREFIX_HCE.toByteArray(Charsets.UTF_8) + uuid(credentialId) + nonce + uuid(kioskId) + u64(ts)

  fun scanMessage(credentialId: UUID, nonce: ByteArray, kioskId: UUID, ts: Long): ByteArray =
    PREFIX_SCAN.toByteArray(Charsets.UTF_8) + uuid(credentialId) + nonce + uuid(kioskId) + u64(ts)

  fun popMessage(sessionId: UUID, popNonce: ByteArray): ByteArray =
    PREFIX_POP.toByteArray(Charsets.UTF_8) + uuid(sessionId) + popNonce

  fun uuid(u: UUID): ByteArray = ByteBuffer.allocate(16).putLong(u.mostSignificantBits).putLong(u.leastSignificantBits).array()

  fun u64(v: Long): ByteArray = ByteBuffer.allocate(8).putLong(v).array()

  fun hex(s: String): ByteArray = ByteArray(s.length / 2) { i -> s.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

  fun toHex(b: ByteArray): String = b.joinToString("") { "%02X".format(it) }
}
