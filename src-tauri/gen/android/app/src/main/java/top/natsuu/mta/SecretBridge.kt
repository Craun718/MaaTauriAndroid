package top.natsuu.mta

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecretBridge {
    private const val KEY_ALIAS = "maa_tauri_android_configuration_secrets"
    private const val TAG_SIZE = 128
    private const val SEPARATOR = "."
    private const val TRANSFORMATION =
        "${KeyProperties.KEY_ALGORITHM_AES}/${KeyProperties.BLOCK_MODE_GCM}/${KeyProperties.ENCRYPTION_PADDING_NONE}"

    @JvmStatic
    fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val encoder = Base64.getUrlEncoder().withoutPadding()
        return "enc:v1:${encoder.encodeToString(iv)}$SEPARATOR${encoder.encodeToString(ciphertext)}"
    }

    @JvmStatic
    fun decrypt(value: String): String {
        val encoded = value.removePrefix("enc:v1:")
        val (iv, ciphertext) = encoded.split(SEPARATOR).let { parts ->
            require(parts.size == 2) { "Invalid encrypted secret format" }
            Pair(parts[0], parts[1])
        }
        val decoder = Base64.getUrlDecoder()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(TAG_SIZE, decoder.decode(iv))
        )
        return String(cipher.doFinal(decoder.decode(ciphertext)), Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }
}
