package top.natsuu.mta

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.view.Surface
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import org.json.JSONObject

/**
 * Encodes the existing GPU preview into H.264 and serves it only to this app's
 * WebView. The Maa recognition path continues to use its independent RGBA copy.
 */
object VirtualDisplayStreamHost {
    private const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC
    private const val WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    private const val PATH = "/virtual-display-stream"
    private const val FRAME_FLAG_KEY = 1

    private val startStopMutex = Any()
    private val running = AtomicBoolean(false)
    private var codecConfigReady = CountDownLatch(1)
    private val clients = CopyOnWriteArrayList<StreamClient>()

    private var codec: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var outputThread: Thread? = null
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private var token = UUID.randomUUID().toString()
    private var annexBConfig = ByteArray(0)

    @Volatile
    private var codecString = "avc1.42E01F"

    @Volatile
    private var streamWidth = 0

    @Volatile
    private var streamHeight = 0

    @Volatile
    private var streamUrl: String? = null

    fun start(width: Int, height: Int): Surface? {
        synchronized(startStopMutex) {
            if (running.get()) return inputSurface
            if (width <= 0 || height <= 0) return null

            token = UUID.randomUUID().toString().replace("-", "")
            annexBConfig = ByteArray(0)
            codecString = "avc1.42E01F"
            codecConfigReady = CountDownLatch(1)
            val server = ServerSocket().apply {
                bind(InetSocketAddress("127.0.0.1", 0))
                reuseAddress = true
            }
            serverSocket = server
            streamWidth = width
            streamHeight = height
            streamUrl = "ws://127.0.0.1:${server.localPort}$PATH?token=$token"
            running.set(true)

            try {
                val encoder = MediaCodec.createEncoderByType(MIME)
                codec = encoder
                val format = MediaFormat.createVideoFormat(MIME, width, height).apply {
                    setInteger(
                        MediaFormat.KEY_COLOR_FORMAT,
                        MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
                    )
                    setInteger(MediaFormat.KEY_BIT_RATE, 8_000_000)
                    setInteger(MediaFormat.KEY_FRAME_RATE, 60)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                    setInteger(
                        MediaFormat.KEY_BITRATE_MODE,
                        MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR,
                    )
                    setInteger(
                        MediaFormat.KEY_PROFILE,
                        MediaCodecInfo.CodecProfileLevel.AVCProfileMain,
                    )
                }
                encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                val surface = encoder.createInputSurface()
                inputSurface = surface
                encoder.start()

                acceptThread = thread(name = "virtual-display-stream-server") {
                    acceptLoop(server)
                }
                outputThread = thread(name = "virtual-display-stream-encoder") {
                    drainEncoder(encoder)
                }
                // The display already has a producer, so this normally returns
                // immediately. Waiting briefly avoids publishing a guessed codec string.
                codecConfigReady.await(100, TimeUnit.MILLISECONDS)
                return surface
            } catch (error: Exception) {
                stopInternal()
                android.util.Log.e("MTAVirtualDisplay", "Could not start the display stream", error)
                return null
            }
        }
    }

    @JvmStatic
    fun streamUrl(): String? {
        return if (running.get()) streamUrl else null
    }

    @JvmStatic
    fun stop() {
        synchronized(startStopMutex) {
            stopInternal()
        }
    }

    private fun stopInternal() {
        running.set(false)
        streamUrl = null
        clients.toList().forEach(StreamClient::close)
        clients.clear()

        runCatching { serverSocket?.close() }
        serverSocket = null
        acceptThread?.interrupt()
        acceptThread = null

        val encoder = codec
        codec = null
        runCatching { encoder?.signalEndOfInputStream() }
        outputThread?.join(TimeUnit.SECONDS.toMillis(1))
        outputThread = null
        runCatching { encoder?.stop() }
        runCatching { encoder?.release() }

        inputSurface?.release()
        inputSurface = null
    }

    private fun acceptLoop(server: ServerSocket) {
        while (running.get()) {
            try {
                server.soTimeout = 250
                val socket = server.accept()
                synchronized(startStopMutex) {
                    if (!running.get()) {
                        socket.close()
                    } else {
                        clients.toList().forEach(StreamClient::close)
                        clients.clear()
                        val client = StreamClient(socket)
                        if (client.handshake()) {
                            clients.add(client)
                            client.sendConfig(streamWidth, streamHeight)
                            requestSyncFrame()
                            client.start()
                        } else {
                            socket.close()
                        }
                    }
                }
            } catch (_: SocketTimeoutException) {
            } catch (_: IOException) {
                if (running.get()) {
                    android.util.Log.e(
                        "MTAVirtualDisplay",
                        "Virtual display stream accept loop failed",
                    )
                    stopInternal()
                }
            }
        }
    }

    private fun requestSyncFrame() {
        val params = Bundle().apply {
            putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
        }
        runCatching {
            codec?.setParameters(params)
        }
    }

    private fun drainEncoder(encoder: MediaCodec) {
        val info = MediaCodec.BufferInfo()
        while (running.get()) {
            val index = try {
                encoder.dequeueOutputBuffer(info, 10_000)
            } catch (error: IllegalStateException) {
                if (running.get()) {
                    android.util.Log.e(
                        "MTAVirtualDisplay",
                        "Virtual display stream encoder failed",
                        error,
                    )
                }
                break
            }

            when {
                index < 0 -> continue
                info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0 -> {
                    readCodecConfig(encoder, index, info)
                    encoder.releaseOutputBuffer(index, false)
                }
                info.size > 0 -> {
                    val sample = ByteArray(info.size)
                    encoder.getOutputBuffer(index)?.let { buffer ->
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        buffer.get(sample)
                    }
                    val key = info.flags and MediaCodec.BUFFER_FLAG_SYNC_FRAME != 0
                    val payload = if (key && annexBConfig.isNotEmpty()) {
                        annexBConfig + sample
                    } else {
                        sample
                    }
                    broadcast(payload, key, info.presentationTimeUs)
                    encoder.releaseOutputBuffer(index, false)
                }
                else -> encoder.releaseOutputBuffer(index, false)
            }
        }
    }

    private fun readCodecConfig(encoder: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
        val buffer = encoder.getOutputBuffer(index) ?: return
        buffer.position(info.offset)
        buffer.limit(info.offset + info.size)
        val config = ByteArray(info.size)
        buffer.get(config)
        annexBConfig = config
        codecStringFromAnnexB(config)?.let { updatedCodecString ->
            if (codecString != updatedCodecString) {
                codecString = updatedCodecString
                clients.forEach { it.sendConfig(streamWidth, streamHeight) }
            }
        }
        codecConfigReady.countDown()
    }

    private fun codecStringFromAnnexB(config: ByteArray): String? {
        var offset = 0
        while (offset + 4 < config.size) {
            val startLength = when {
                config[offset] == 0.toByte() &&
                    config[offset + 1] == 0.toByte() &&
                    config[offset + 2] == 0.toByte() &&
                    config[offset + 3] == 1.toByte() -> 4
                config[offset] == 0.toByte() &&
                    config[offset + 1] == 0.toByte() &&
                    config[offset + 2] == 1.toByte() -> 3
                else -> 0
            }
            if (startLength != 0) {
                val nalHeader = offset + startLength
                if (nalHeader < config.size && config[nalHeader].toInt() and 0x1f == 7 &&
                    nalHeader + 3 < config.size
                ) {
                    val hex = config.slice(nalHeader + 1..nalHeader + 3)
                        .joinToString("") { "%02X".format(it) }
                    return "avc1.$hex"
                }
            }
            offset += 1
        }
        return null
    }

    private fun broadcast(sample: ByteArray, key: Boolean, presentationTimeUs: Long) {
        if (clients.isEmpty()) return

        val payload = ByteArray(sample.size + 9)
        payload[0] = (if (key) FRAME_FLAG_KEY else 0).toByte()
        for (offset in 0 until 8) {
            payload[1 + offset] = (presentationTimeUs shr ((7 - offset) * 8)).toByte()
        }
        sample.copyInto(payload, 9)
        clients.forEach { it.sendFrame(2, payload) }
    }

    private fun configJson(width: Int, height: Int): String {
        return JSONObject()
            .put("type", "config")
            .put("codec", codecString)
            .put("width", width)
            .put("height", height)
            .toString()
    }

    private class StreamClient(private val socket: Socket) {
        private val active = AtomicBoolean(true)
        private val queue = ArrayBlockingQueue<QueuedFrame>(48)
        private val writerThread = thread(name = "virtual-display-stream-writer") {
            writeLoop()
        }

        fun start() {
            thread(name = "virtual-display-stream-reader") {
                readCloseLoop()
            }
        }

        fun sendConfig(width: Int, height: Int) {
            offer(QueuedFrame(1, configJson(width, height).toByteArray()))
        }

        fun sendFrame(webSocketOpcode: Int, payload: ByteArray) {
            offer(QueuedFrame(webSocketOpcode, payload))
        }

        fun close() {
            if (!active.compareAndSet(true, false)) return
            writerThread.interrupt()
            runCatching { socket.close() }
        }

        private fun offer(frame: QueuedFrame) {
            if (!active.get()) return
            if (frame.opcode == 1) {
                queue.clear()
                queue.offer(frame)
                requestSyncFrame()
                return
            }

            val isKeyFrame = frame.payload.firstOrNull()?.toInt()?.and(FRAME_FLAG_KEY) != 0
            if (isKeyFrame) {
                queue.clear()
                queue.offer(frame)
                return
            }

            if (!queue.offer(frame)) {
                requestSyncFrame()
            }
        }

        private fun writeLoop() {
            try {
                DataOutputStream(BufferedOutputStream(socket.getOutputStream(), 64 * 1024)).use { output ->
                    while (active.get()) {
                        val frame = queue.poll(250, TimeUnit.MILLISECONDS) ?: continue
                        writeWebSocketFrame(output, frame.opcode, frame.payload)
                        output.flush()
                    }
                }
            } catch (error: Exception) {
                if (active.get()) {
                    android.util.Log.e(
                        "MTAVirtualDisplay",
                        "Virtual display stream writer failed",
                        error,
                    )
                }
            } finally {
                active.set(false)
                clients.remove(this)
                runCatching { socket.close() }
            }
        }

        private fun writeWebSocketFrame(output: DataOutputStream, opcode: Int, payload: ByteArray) {
            output.writeByte(0x80 or opcode)
            when {
                payload.size < 126 -> output.writeByte(payload.size)
                payload.size < 65536 -> {
                    output.writeByte(126)
                    output.writeShort(payload.size)
                }
                else -> {
                    output.writeByte(127)
                    output.writeLong(payload.size.toLong())
                }
            }
            output.write(payload)
        }

        fun handshake(): Boolean {
            return runCatching {
                socket.tcpNoDelay = true
                socket.soTimeout = 2_000
                val input = DataInputStream(socket.getInputStream().buffered())
                val request = buildString {
                    while (true) {
                        val line = input.readLine() ?: return false
                        if (line.isEmpty()) break
                        append(line).append('\n')
                    }
                }
                val lines = request.lines().toList()
                val target = lines.firstOrNull()?.split(" ")?.getOrNull(1)
                if (target != "$PATH?token=$token") return false

                val headers = lines.drop(1).mapNotNull { line ->
                    val separator = line.indexOf(':')
                    if (separator <= 0) {
                        null
                    } else {
                        line.take(separator).trim().lowercase() to
                            line.substring(separator + 1).trim()
                    }
                }.toMap()
                val key = headers["sec-websocket-key"] ?: return false
                if (headers["upgrade"]?.lowercase() != "websocket" ||
                    headers["connection"]?.lowercase()?.contains("upgrade") != true
                ) {
                    return false
                }

                val digest = MessageDigest.getInstance("SHA-1")
                    .digest((key + WEBSOCKET_GUID).toByteArray(Charsets.ISO_8859_1))
                val accept = Base64.getEncoder().encodeToString(digest)
                // Closing this stream would also close the socket before the
                // dedicated writer takes ownership of it.
                val output = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))
                output.write(
                    (
                        "HTTP/1.1 101 Switching Protocols\r\n" +
                            "Upgrade: websocket\r\n" +
                            "Connection: Upgrade\r\n" +
                            "Sec-WebSocket-Accept: $accept\r\n\r\n"
                        ).toByteArray(Charsets.ISO_8859_1),
                )
                output.flush()
                socket.soTimeout = 0
                true
            }.getOrDefault(false)
        }

        private fun readCloseLoop() {
            try {
                DataInputStream(socket.getInputStream()).use { input ->
                    while (active.get()) {
                        val first = input.readUnsignedByte()
                        val opcode = first and 0x0f
                        val second = input.readUnsignedByte()
                        val masked = second and 0x80 != 0
                        var length = (second and 0x7f).toLong()
                        if (length == 126L) length = input.readUnsignedShort().toLong()
                        if (length == 127L) length = input.readLong()
                        if (masked) {
                            var maskRemaining = 4
                            while (maskRemaining > 0) {
                                val skipped = input.skip(maskRemaining.toLong())
                                if (skipped <= 0L) return
                                maskRemaining -= skipped.toInt()
                            }
                        }
                        while (length > 0) {
                            val skipped = input.skip(length)
                            if (skipped <= 0) return
                            length -= skipped
                        }
                        if (opcode == 8) return
                    }
                }
            } catch (error: Exception) {
                if (active.get()) {
                    android.util.Log.w(
                        "MTAVirtualDisplay",
                        "Virtual display stream reader failed",
                        error,
                    )
                }
            } finally {
                close()
                clients.remove(this)
            }
        }
    }

    private class QueuedFrame(val opcode: Int, val payload: ByteArray)
}
