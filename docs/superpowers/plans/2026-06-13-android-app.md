# 安卓 App（子项目二）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 安卓原生 app（Kotlin + Jetpack Compose），经 Tailscale 连接会话宿主，列出/接管 Claude Code 会话，终端镜像显示并交互，前台服务长连接 + Claude 停下/请求授权时弹本地通知。

**Architecture:** 单 Activity + Compose 导航。`HostClient`（OkHttp WebSocket 客户端，实现宿主协议，纯 Kotlin 可单测）→ `SessionRepository`（StateFlow 持有会话列表与连接状态）→ Compose UI（设置页 / 会话列表页 / 终端页）。终端渲染用 Termux 的 terminal-emulator + terminal-view（Apache 2.0，作为本地源码模块 vendored），通过 AndroidView 嵌入 Compose；不自研 ANSI 解析。前台服务 `ConnectionService` 持有 WebSocket，收到 stop/permission_request 事件发本地通知。

**Tech Stack:** Kotlin、Jetpack Compose（Material3）、OkHttp（WebSocket）、kotlinx-serialization（JSON）、DataStore（设置/token 持久化）、Termux terminal-emulator/terminal-view（vendored 源码模块）、AGP 8.7 + Gradle 8.9 + JDK 17、compileSdk 35 / minSdk 26。

**工具链与部署：** SDK 在 `D:\Android\Sdk`，JDK 在 `D:\Java\jdk17\jdk-17.0.19+10`。无线 adb（Wi-Fi 调试）部署到手机（已在 Tailnet：100.119.205.29）。宿主在 100.125.66.90:8787，token 见 `host/data/config.json`。

**协议（已由宿主固定，app 必须严格对齐）：**
- 客户端→宿主：`{type:'auth',token}`、`{type:'list'}`、`{type:'create',cwd,name?}`、`{type:'attach',sessionId,cols,rows}`、`{type:'input',sessionId,data}`(data=base64 of utf8 输入)、`{type:'resize',sessionId,cols,rows}`、`{type:'detach',sessionId}`、`{type:'kill',sessionId}`
- 宿主→客户端：`{type:'auth_ok'}`、`{type:'sessions',sessions:[{id,name,cwd,state,createdAt,orphaned?}]}`(state∈working/waiting/exited)、`{type:'created',sessionId}`、`{type:'output',sessionId,data}`(data=base64 of 终端字节)、`{type:'event',sessionId,kind}`(kind∈stop/permission_request/session_exited)、`{type:'error',message}`
- 鉴权：连上后第一条必须是 auth，token 错→收到 error 且连接被关闭。

**约定：** app 代码放仓库 `app/` 目录。所有 Gradle 命令用 `D:\Android\Sdk` 与 `D:\Java\jdk17`，PowerShell 执行。

---

## 文件结构

```
app/
  settings.gradle.kts          # 含 terminal-emulator/terminal-view 模块
  build.gradle.kts             # 根
  gradle.properties            # JDK/AndroidX 配置
  gradlew.bat / gradle/        # wrapper（Gradle 8.9）
  local.properties             # sdk.dir=D:\\Android\\Sdk（gitignore）
  app/
    build.gradle.kts
    src/main/AndroidManifest.xml
    src/main/java/com/claude/remote/
      MainActivity.kt           # 单 Activity，承载 Compose 导航
      net/
        Protocol.kt             # @Serializable 消息类型（client/host）
        HostClient.kt           # OkHttp WebSocket，发/收协议消息，回调/Flow
      data/
        Session.kt              # 会话数据模型（id,name,cwd,state,createdAt,orphaned）
        SessionRepository.kt    # 连接状态 + 会话列表 StateFlow，封装 HostClient
        Settings.kt             # DataStore：hostUrl + token
      ui/
        SettingsScreen.kt
        SessionListScreen.kt
        TerminalScreen.kt       # AndroidView 包 TerminalView + 快捷键栏
        theme/                  # Compose 主题
      service/
        ConnectionService.kt    # 前台服务，持 WebSocket，事件→本地通知
        Notifications.kt        # 通知渠道与构建
    src/test/java/com/claude/remote/
      ProtocolTest.kt           # 序列化/反序列化往返
      HostClientTest.kt         # 用 MockWebServer 跑协议全流程
  terminal-emulator/            # vendored from termux-app（Apache 2.0）
  terminal-view/                # vendored from termux-app（Apache 2.0）
```

---

## 里程碑与执行说明

| 里程碑 | 内容 | 本计划详度 |
|---|---|---|
| **M4** | 工程能编译、无线装到手机、连上宿主、显示会话列表 | 完整可执行（Task 1–9） |
| **M5** | 终端页：Termux 终端渲染 + 输入回传 | 路线 + 任务骨架（Task 10–13），代码在 M4 跑通后逐任务细化 |
| **M6** | 前台服务长连接 + 本地通知 | 路线 + 任务骨架（Task 14–16） |
| **M7** | 快捷键栏、转屏/resize、体验打磨 | 路线 + 任务骨架（Task 17–19） |

**为什么这样分：** M4 全部是可单测的纯逻辑（协议、客户端、仓库、设置）+ 可自动化验证的构建/部署，能盲写到精确。M5–M7 涉及 Termux 集成、真机 UI/通知行为，必须在手机上实际跑起来才能调对 API 细节；强行盲写"精确代码"会是假精确。因此 M5 起每个里程碑开工前，由执行者基于 M4 验证过的环境，先做一次小 spike 确认 Termux API/服务行为，再补全该里程碑任务的精确代码。

---

## M4：地基（可编译 / 可部署 / 连上 / 列表）

### Task 1: Gradle 工程脚手架

**Files:**
- Create: `app/settings.gradle.kts`, `app/build.gradle.kts`, `app/gradle.properties`, `app/local.properties`, `app/gradle/wrapper/gradle-wrapper.properties`, `app/app/build.gradle.kts`, `app/app/src/main/AndroidManifest.xml`
- Modify: `.gitignore`

- [ ] **Step 1: 写 wrapper 与根配置**

`app/gradle/wrapper/gradle-wrapper.properties`:
```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.9-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

`app/gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
```

`app/local.properties`（gitignore，指向 SDK）:
```properties
sdk.dir=D:\\Android\\Sdk
```

`app/settings.gradle.kts`:
```kotlin
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "ClaudeRemote"
include(":app")
```

`app/build.gradle.kts`:
```kotlin
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
```

在仓库根 `.gitignore` 追加：
```
app/.gradle/
app/build/
app/app/build/
app/local.properties
app/.idea/
.gradle/
```

- [ ] **Step 2: 写 app 模块 build.gradle.kts**

`app/app/build.gradle.kts`:
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.claude.remote"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.claude.remote"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-service:2.8.6")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
```

- [ ] **Step 3: 写最小 Manifest 与占位 MainActivity**

`app/app/src/main/AndroidManifest.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:label="Claude Remote"
        android:theme="@android:style/Theme.Material.NoActionBar"
        android:usesCleartextTraffic="true">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```
（`usesCleartextTraffic=true` 因为宿主是 http/ws 明文，经 Tailscale 加密；属设计取舍。）

`app/app/src/main/java/com/claude/remote/MainActivity.kt`:
```kotlin
package com.claude.remote

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface { Text("Claude Remote") }
            }
        }
    }
}
```

- [ ] **Step 4: 生成 gradle wrapper jar 并构建**

Run（先用本机 gradle 或下载 wrapper jar；若无 gradle，从 distributionUrl 解出 wrapper jar——执行者按环境处理）:
```powershell
$env:JAVA_HOME='D:\Java\jdk17\jdk-17.0.19+10'
Set-Location C:\Users\galaxy\code\claude_tip\app
.\gradlew.bat :app:assembleDebug --no-daemon
```
Expected: BUILD SUCCESSFUL，生成 `app/app/build/outputs/apk/debug/app-debug.apk`
（首次会下载 Gradle 8.9 + 依赖，耗时数分钟。若 gradlew.bat/wrapper jar 缺失，执行者需先 `gradle wrapper --gradle-version 8.9` 或手动放入 wrapper jar。）

- [ ] **Step 5: Commit**
```powershell
git add app/ .gitignore
git commit -m "feat(app): Gradle 工程脚手架，可编译出 debug APK"
```

---

### Task 2: 协议消息模型（Protocol.kt）+ 序列化测试

**Files:**
- Create: `app/app/src/main/java/com/claude/remote/net/Protocol.kt`
- Test: `app/app/src/test/java/com/claude/remote/ProtocolTest.kt`

- [ ] **Step 1: 写失败测试**

`app/app/src/test/java/com/claude/remote/ProtocolTest.kt`:
```kotlin
package com.claude.remote

import com.claude.remote.net.ClientMsg
import com.claude.remote.net.HostMsg
import com.claude.remote.net.decodeHostMsg
import com.claude.remote.net.encode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    @Test fun auth_encodes_with_type_and_token() {
        val json = ClientMsg.Auth("tok123").encode()
        assertTrue(json.contains("\"type\":\"auth\""))
        assertTrue(json.contains("\"token\":\"tok123\""))
    }

    @Test fun attach_encodes_all_fields() {
        val json = ClientMsg.Attach("s1", 80, 24).encode()
        assertTrue(json.contains("\"type\":\"attach\""))
        assertTrue(json.contains("\"sessionId\":\"s1\""))
        assertTrue(json.contains("\"cols\":80"))
        assertTrue(json.contains("\"rows\":24"))
    }

    @Test fun decode_sessions_message() {
        val raw = """{"type":"sessions","sessions":[{"id":"a","name":"proj","cwd":"C:/x","state":"waiting","createdAt":"t","orphaned":true}]}"""
        val msg = decodeHostMsg(raw)
        assertTrue(msg is HostMsg.Sessions)
        val s = (msg as HostMsg.Sessions).sessions.single()
        assertEquals("a", s.id); assertEquals("waiting", s.state); assertEquals(true, s.orphaned)
    }

    @Test fun decode_output_and_event() {
        assertTrue(decodeHostMsg("""{"type":"output","sessionId":"a","data":"aGk="}""") is HostMsg.Output)
        val ev = decodeHostMsg("""{"type":"event","sessionId":"a","kind":"stop"}""")
        assertTrue(ev is HostMsg.Event); assertEquals("stop", (ev as HostMsg.Event).kind)
    }

    @Test fun decode_unknown_type_is_Unknown_not_crash() {
        assertTrue(decodeHostMsg("""{"type":"weird"}""") is HostMsg.Unknown)
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```powershell
$env:JAVA_HOME='D:\Java\jdk17\jdk-17.0.19+10'; Set-Location C:\Users\galaxy\code\claude_tip\app
.\gradlew.bat :app:testDebugUnitTest --tests "com.claude.remote.ProtocolTest" --no-daemon
```
Expected: 编译失败/测试失败（Protocol.kt 不存在）

- [ ] **Step 3: 实现 Protocol.kt**

`app/app/src/main/java/com/claude/remote/net/Protocol.kt`:
```kotlin
package com.claude.remote.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

@Serializable
data class SessionDto(
    val id: String,
    val name: String,
    val cwd: String,
    val state: String,
    val createdAt: String,
    val orphaned: Boolean = false,
)

/** 客户端→宿主。手写 encode 以保证字段名/结构与宿主完全一致。 */
sealed interface ClientMsg {
    fun encode(): String
    data class Auth(val token: String) : ClientMsg {
        override fun encode() = """{"type":"auth","token":${q(token)}}"""
    }
    data object ListSessions : ClientMsg {
        override fun encode() = """{"type":"list"}"""
    }
    data class Create(val cwd: String, val name: String? = null) : ClientMsg {
        override fun encode() =
            if (name == null) """{"type":"create","cwd":${q(cwd)}}"""
            else """{"type":"create","cwd":${q(cwd)},"name":${q(name)}}"""
    }
    data class Attach(val sessionId: String, val cols: Int, val rows: Int) : ClientMsg {
        override fun encode() = """{"type":"attach","sessionId":${q(sessionId)},"cols":$cols,"rows":$rows}"""
    }
    data class Input(val sessionId: String, val dataB64: String) : ClientMsg {
        override fun encode() = """{"type":"input","sessionId":${q(sessionId)},"data":${q(dataB64)}}"""
    }
    data class Resize(val sessionId: String, val cols: Int, val rows: Int) : ClientMsg {
        override fun encode() = """{"type":"resize","sessionId":${q(sessionId)},"cols":$cols,"rows":$rows}"""
    }
    data class Detach(val sessionId: String) : ClientMsg {
        override fun encode() = """{"type":"detach","sessionId":${q(sessionId)}}"""
    }
    data class Kill(val sessionId: String) : ClientMsg {
        override fun encode() = """{"type":"kill","sessionId":${q(sessionId)}}"""
    }
}

private fun q(s: String): String = json.encodeToString(kotlinx.serialization.builtins.serializer(), s)

/** 宿主→客户端。 */
sealed interface HostMsg {
    data object AuthOk : HostMsg
    data class Sessions(val sessions: List<SessionDto>) : HostMsg
    data class Created(val sessionId: String) : HostMsg
    data class Output(val sessionId: String, val dataB64: String) : HostMsg
    data class Event(val sessionId: String, val kind: String) : HostMsg
    data class Error(val message: String) : HostMsg
    data object Unknown : HostMsg
}

@Serializable private data class SessionsWire(val sessions: List<SessionDto> = emptyList())

fun decodeHostMsg(raw: String): HostMsg {
    val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return HostMsg.Unknown
    fun str(k: String) = obj[k]?.jsonPrimitive?.contentOrNull
    return when (str("type")) {
        "auth_ok" -> HostMsg.AuthOk
        "sessions" -> HostMsg.Sessions(json.decodeFromString(SessionsWire.serializer(), raw).sessions)
        "created" -> HostMsg.Created(str("sessionId").orEmpty())
        "output" -> HostMsg.Output(str("sessionId").orEmpty(), str("data").orEmpty())
        "event" -> HostMsg.Event(str("sessionId").orEmpty(), str("kind").orEmpty())
        "error" -> HostMsg.Error(str("message").orEmpty())
        else -> HostMsg.Unknown
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests "com.claude.remote.ProtocolTest" --no-daemon`
Expected: 5 个测试 PASS

- [ ] **Step 5: Commit**
```powershell
git add app/app/src/main/java/com/claude/remote/net/Protocol.kt app/app/src/test/java/com/claude/remote/ProtocolTest.kt
git commit -m "feat(app): 协议消息模型与序列化（5 测试）"
```

---

### Task 3: HostClient（WebSocket 客户端）+ MockWebServer 集成测试

**Files:**
- Create: `app/app/src/main/java/com/claude/remote/net/HostClient.kt`
- Test: `app/app/src/test/java/com/claude/remote/HostClientTest.kt`

- [ ] **Step 1: 写失败测试（用 MockWebServer 模拟宿主）**

`app/app/src/test/java/com/claude/remote/HostClientTest.kt`:
```kotlin
package com.claude.remote

import com.claude.remote.net.HostClient
import com.claude.remote.net.HostMsg
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.QueueDispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HostClientTest {
    private lateinit var server: MockWebServer
    @Before fun setup() { server = MockWebServer(); server.start() }
    @After fun teardown() { server.shutdown() }

    @Test fun connects_and_emits_auth_then_receives_authok() = runBlocking {
        // 宿主侧：收到 auth 文本后回 auth_ok
        val received = Channel<String>(Channel.UNLIMITED)
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                received.trySend(text)
                if (text.contains("\"type\":\"auth\"")) ws.send("""{"type":"auth_ok"}""")
            }
        }))
        val msgs = Channel<HostMsg>(Channel.UNLIMITED)
        val client = HostClient(
            url = server.url("/").toString().replace("http", "ws"),
            token = "tok",
            onMessage = { msgs.trySend(it) },
            onState = {},
        )
        client.connect()
        withTimeout(5000) {
            assertTrue(received.receive().contains("\"type\":\"auth\""))
            assertTrue(msgs.receive() is HostMsg.AuthOk)
        }
        client.close()
    }

    @Test fun send_list_after_connect() = runBlocking {
        val received = Channel<String>(Channel.UNLIMITED)
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                received.trySend(text)
                if (text.contains("\"type\":\"auth\"")) ws.send("""{"type":"auth_ok"}""")
            }
        }))
        val client = HostClient(server.url("/").toString().replace("http","ws"), "tok", {}, {})
        client.connect()
        withTimeout(5000) {
            received.receive() // auth
            client.send(com.claude.remote.net.ClientMsg.ListSessions)
            assertEquals(true, received.receive().contains("\"type\":\"list\""))
        }
        client.close()
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests "com.claude.remote.HostClientTest" --no-daemon`
Expected: 编译失败（HostClient 不存在）

- [ ] **Step 3: 实现 HostClient.kt**

`app/app/src/main/java/com/claude/remote/net/HostClient.kt`:
```kotlin
package com.claude.remote.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response
import java.util.concurrent.TimeUnit

enum class ConnState { CONNECTING, CONNECTED, DISCONNECTED }

/**
 * 宿主 WebSocket 客户端。连接成功后自动发送 auth。
 * onMessage 在 OkHttp 的 WS 线程回调；调用方自行切线程。
 */
class HostClient(
    private val url: String,
    private val token: String,
    private val onMessage: (HostMsg) -> Unit,
    private val onState: (ConnState) -> Unit,
) {
    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    @Volatile private var ws: WebSocket? = null

    fun connect() {
        onState(ConnState.CONNECTING)
        val req = Request.Builder().url(url).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(ClientMsg.Auth(token).encode())
                onState(ConnState.CONNECTED)
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                onMessage(decodeHostMsg(text))
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onState(ConnState.DISCONNECTED)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onState(ConnState.DISCONNECTED)
            }
        })
    }

    fun send(msg: ClientMsg) { ws?.send(msg.encode()) }

    fun close() {
        ws?.close(1000, null)
        ws = null
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests "com.claude.remote.HostClientTest" --no-daemon`
Expected: 2 个测试 PASS

- [ ] **Step 5: Commit**
```powershell
git add app/app/src/main/java/com/claude/remote/net/HostClient.kt app/app/src/test/java/com/claude/remote/HostClientTest.kt
git commit -m "feat(app): WebSocket 宿主客户端（MockWebServer 集成测试）"
```

---

### Task 4: 设置持久化（Settings.kt，DataStore）

**Files:**
- Create: `app/app/src/main/java/com/claude/remote/data/Settings.kt`

- [ ] **Step 1: 实现 Settings.kt（DataStore 包装，难单测，靠后续真机验证）**

`app/app/src/main/java/com/claude/remote/data/Settings.kt`:
```kotlin
package com.claude.remote.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "settings")

data class HostConfig(val url: String, val token: String) {
    val isConfigured get() = url.isNotBlank() && token.isNotBlank()
}

class Settings(private val context: Context) {
    private val KEY_URL = stringPreferencesKey("host_url")
    private val KEY_TOKEN = stringPreferencesKey("token")

    val config: Flow<HostConfig> = context.dataStore.data.map {
        HostConfig(it[KEY_URL] ?: "", it[KEY_TOKEN] ?: "")
    }

    suspend fun save(url: String, token: String) {
        context.dataStore.edit { it[KEY_URL] = url.trim(); it[KEY_TOKEN] = token.trim() }
    }
}
```

- [ ] **Step 2: 编译确认通过**

Run: `.\gradlew.bat :app:compileDebugKotlin --no-daemon`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**
```powershell
git add app/app/src/main/java/com/claude/remote/data/Settings.kt
git commit -m "feat(app): 设置持久化（DataStore：hostUrl+token）"
```

---

### Task 5: SessionRepository（连接状态 + 会话列表 StateFlow）

**Files:**
- Create: `app/app/src/main/java/com/claude/remote/data/Session.kt`
- Create: `app/app/src/main/java/com/claude/remote/data/SessionRepository.kt`
- Test: `app/app/src/test/java/com/claude/remote/SessionRepositoryTest.kt`

- [ ] **Step 1: 写失败测试**

`app/app/src/test/java/com/claude/remote/SessionRepositoryTest.kt`:
```kotlin
package com.claude.remote

import com.claude.remote.data.SessionRepository
import com.claude.remote.net.HostMsg
import com.claude.remote.net.SessionDto
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionRepositoryTest {
    @Test fun sessions_message_updates_state() {
        val repo = SessionRepository()
        repo.onHostMsg(HostMsg.Sessions(listOf(
            SessionDto("a","p","C:/x","working","t"),
            SessionDto("b","q","C:/y","waiting","t", orphaned = true),
        )))
        assertEquals(2, repo.sessions.value.size)
        assertEquals("working", repo.sessions.value[0].state)
        assertEquals(true, repo.sessions.value[1].orphaned)
    }

    @Test fun error_message_is_exposed() {
        val repo = SessionRepository()
        repo.onHostMsg(HostMsg.Error("鉴权失败"))
        assertEquals("鉴权失败", repo.lastError.value)
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests "com.claude.remote.SessionRepositoryTest" --no-daemon`
Expected: 编译失败

- [ ] **Step 3: 实现 Session.kt 与 SessionRepository.kt**

`app/app/src/main/java/com/claude/remote/data/Session.kt`:
```kotlin
package com.claude.remote.data

data class Session(
    val id: String,
    val name: String,
    val cwd: String,
    val state: String,   // working | waiting | exited
    val createdAt: String,
    val orphaned: Boolean,
)
```

`app/app/src/main/java/com/claude/remote/data/SessionRepository.kt`:
```kotlin
package com.claude.remote.data

import com.claude.remote.net.HostMsg
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 纯逻辑状态容器：消费 HostMsg，维护会话列表与最近错误，供 UI 观察。
 * 不直接持有网络/线程，便于单测。
 */
class SessionRepository {
    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions
    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    fun onHostMsg(msg: HostMsg) {
        when (msg) {
            is HostMsg.Sessions -> _sessions.value = msg.sessions.map {
                Session(it.id, it.name, it.cwd, it.state, it.createdAt, it.orphaned)
            }
            is HostMsg.Error -> _lastError.value = msg.message
            else -> {}
        }
    }

    fun clearError() { _lastError.value = null }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests "com.claude.remote.SessionRepositoryTest" --no-daemon`
Expected: 2 个测试 PASS

- [ ] **Step 5: Commit**
```powershell
git add app/app/src/main/java/com/claude/remote/data/Session.kt app/app/src/main/java/com/claude/remote/data/SessionRepository.kt app/app/src/test/java/com/claude/remote/SessionRepositoryTest.kt
git commit -m "feat(app): 会话仓库状态容器（2 测试）"
```

---

### Task 6: 无线 adb 配对与设备连接（环境，非代码）

**Files:** 无（环境配置 + 文档）

- [ ] **Step 1: 引导用户在手机上开启无线调试**

在手机：设置 → 关于手机 → 连续点"版本号"7 次开启开发者选项 → 系统 → 开发者选项 → 开启"无线调试" → 点进"无线调试" → "使用配对码配对设备"，得到一个 `IP:端口` 和 6 位配对码。
（执行者：这一步需要用户操作，向用户索取配对 IP:端口 与配对码。）

- [ ] **Step 2: 配对并连接**

Run（用配对得到的值，注意配对端口与连接端口不同）:
```powershell
$adb='D:\Android\Sdk\platform-tools\adb.exe'
& $adb pair <手机IP>:<配对端口> <配对码>
& $adb connect <手机IP>:<无线调试端口>
& $adb devices
```
Expected: `adb devices` 列出手机为 `device`（非 unauthorized/offline）

- [ ] **Step 3: 记录连接信息到 README（便于复连）**

创建 `app/README.md` 记录：JDK/SDK 路径、构建命令、无线 adb 连接步骤、装 APK 命令。
（设备重启或 Wi-Fi 变化后端口会变，需重新 connect。）

- [ ] **Step 4: Commit**
```powershell
git add app/README.md
git commit -m "docs(app): 构建与无线 adb 部署说明"
```

---

### Task 7: 设置页 + 会话列表页（Compose UI）

**Files:**
- Create: `app/app/src/main/java/com/claude/remote/ui/SettingsScreen.kt`
- Create: `app/app/src/main/java/com/claude/remote/ui/SessionListScreen.kt`
- Create: `app/app/src/main/java/com/claude/remote/ui/theme/Theme.kt`
- Modify: `app/app/src/main/java/com/claude/remote/MainActivity.kt`

- [ ] **Step 1: 写主题**

`app/app/src/main/java/com/claude/remote/ui/theme/Theme.kt`:
```kotlin
package com.claude.remote.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()
    MaterialTheme(colorScheme = colors, content = content)
}
```

- [ ] **Step 2: 写设置页**

`app/app/src/main/java/com/claude/remote/ui/SettingsScreen.kt`:
```kotlin
package com.claude.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun SettingsScreen(
    initialUrl: String,
    initialToken: String,
    onSave: (String, String) -> Unit,
) {
    var url by remember(initialUrl) { mutableStateOf(initialUrl.ifBlank { "ws://100.125.66.90:8787" }) }
    var token by remember(initialToken) { mutableStateOf(initialToken) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("宿主设置", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(url, { url = it }, label = { Text("宿主地址 (ws://IP:端口)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(token, { token = it }, label = { Text("Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(onClick = { onSave(url.trim(), token.trim()) }, modifier = Modifier.fillMaxWidth()) { Text("保存并连接") }
    }
}
```

- [ ] **Step 3: 写会话列表页**

`app/app/src/main/java/com/claude/remote/ui/SessionListScreen.kt`:
```kotlin
package com.claude.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.claude.remote.data.Session

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    sessions: List<Session>,
    connState: String,
    onOpen: (Session) -> Unit,
    onNew: () -> Unit,
    onSettings: () -> Unit,
) {
    Scaffold(
        topBar = { TopAppBar(title = { Text("会话 · $connState") }, actions = {
            TextButton(onClick = onSettings) { Text("设置") }
        }) },
        floatingActionButton = { FloatingActionButton(onClick = onNew) { Text("+") } },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            items(sessions, key = { it.id }) { s ->
                val clickable = !(s.state == "exited" && s.orphaned)
                ListItem(
                    headlineContent = { Text(s.name) },
                    supportingContent = { Text(s.cwd, maxLines = 1) },
                    trailingContent = {
                        val (label, color) = when (s.state) {
                            "working" -> "干活中" to Color(0xFF6EC1FF)
                            "waiting" -> "等输入" to Color(0xFFFFD866)
                            else -> (if (s.orphaned) "中断" else "已结束") to Color.Gray
                        }
                        Text(label, color = color)
                    },
                    modifier = if (clickable) Modifier.clickable { onOpen(s) } else Modifier,
                )
                HorizontalDivider()
            }
        }
    }
}
```

- [ ] **Step 4: 编译确认通过**

Run: `.\gradlew.bat :app:compileDebugKotlin --no-daemon`
Expected: BUILD SUCCESSFUL（MainActivity 仍是占位，下一 Task 接线）

- [ ] **Step 5: Commit**
```powershell
git add app/app/src/main/java/com/claude/remote/ui/
git commit -m "feat(app): 设置页与会话列表页 Compose UI"
```

---

### Task 8: 接线 MainActivity（导航 + 仓库 + 客户端）

**Files:**
- Modify: `app/app/src/main/java/com/claude/remote/MainActivity.kt`

- [ ] **Step 1: 实现导航与状态接线**

`app/app/src/main/java/com/claude/remote/MainActivity.kt`（完整替换）:
```kotlin
package com.claude.remote

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.claude.remote.data.Settings
import com.claude.remote.data.SessionRepository
import com.claude.remote.net.ClientMsg
import com.claude.remote.net.ConnState
import com.claude.remote.net.HostClient
import com.claude.remote.net.HostMsg
import com.claude.remote.ui.SessionListScreen
import com.claude.remote.ui.SettingsScreen
import com.claude.remote.ui.theme.AppTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val repo = SessionRepository()
    private var client: HostClient? = null
    private val connState = androidx.compose.runtime.mutableStateOf(ConnState.DISCONNECTED)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val settings = Settings(applicationContext)
        setContent {
            AppTheme {
                var screen by remember { mutableStateOf("loading") }
                var cfgUrl by remember { mutableStateOf("") }
                var cfgToken by remember { mutableStateOf("") }
                val sessions by repo.sessions.collectAsStateWithLifecycle()
                val conn by connState

                LaunchedEffect(Unit) {
                    val c = settings.config.first()
                    cfgUrl = c.url; cfgToken = c.token
                    screen = if (c.isConfigured) { connect(c.url, c.token); "list" } else "settings"
                }

                when (screen) {
                    "settings" -> SettingsScreen(cfgUrl, cfgToken) { url, token ->
                        lifecycleScope.launch {
                            settings.save(url, token); cfgUrl = url; cfgToken = token
                            connect(url, token); screen = "list"
                        }
                    }
                    "list" -> SessionListScreen(
                        sessions = sessions,
                        connState = when (conn) { ConnState.CONNECTED -> "已连接"; ConnState.CONNECTING -> "连接中"; else -> "未连接" },
                        onOpen = { /* M5：打开终端页 */ },
                        onNew = { client?.send(ClientMsg.Create(cwd = "C:\\Users\\galaxy\\code")) },
                        onSettings = { screen = "settings" },
                    )
                }
            }
        }
    }

    private fun connect(url: String, token: String) {
        client?.close()
        client = HostClient(
            url = url, token = token,
            onMessage = { msg ->
                runOnUiThread {
                    repo.onHostMsg(msg)
                    if (msg is HostMsg.AuthOk) client?.send(ClientMsg.ListSessions)
                }
            },
            onState = { runOnUiThread { connState.value = it } },
        )
        client!!.connect()
    }

    override fun onDestroy() { super.onDestroy(); client?.close() }
}
```

- [ ] **Step 2: 编译 + 装到手机 + 冒烟验证（M4 里程碑）**

Run:
```powershell
$env:JAVA_HOME='D:\Java\jdk17\jdk-17.0.19+10'; Set-Location C:\Users\galaxy\code\claude_tip\app
.\gradlew.bat :app:assembleDebug --no-daemon
D:\Android\Sdk\platform-tools\adb.exe install -r app\app\build\outputs\apk\debug\app-debug.apk
D:\Android\Sdk\platform-tools\adb.exe shell am start -n com.claude.remote/.MainActivity
```
Expected: APK 安装成功，app 启动；首次进设置页，填 `ws://100.125.66.90:8787` + token 保存后进入列表页，**显示宿主上的会话列表，连接状态"已连接"**。
（宿主需在电脑上运行。执行者用 `adb logcat` 看连接日志排错。）

- [ ] **Step 3: Commit**
```powershell
git add app/app/src/main/java/com/claude/remote/MainActivity.kt
git commit -m "feat(app): 接线导航+仓库+客户端，M4：手机显示会话列表"
```

---

### Task 9: M4 验收与回归

- [ ] **Step 1: 跑全部单测**

Run: `.\gradlew.bat :app:testDebugUnitTest --no-daemon`
Expected: Protocol(5) + HostClient(2) + SessionRepository(2) = 9 测试全 PASS

- [ ] **Step 2: 真机验收清单（人工）**
  - 设置页保存后自动连接、状态变"已连接"
  - 会话列表实时反映宿主端（用 `cc` 在电脑新建会话，手机列表出现）
  - 状态颜色：干活中/等输入/已结束 正确
  - 杀掉宿主→app 状态变"未连接"；重开宿主→自动恢复（M4 暂不要求自动重连，可手动重进）

- [ ] **Step 3: Commit（若有修补）**

---

## M5：终端页（Termux 终端渲染 + 输入回传）

**开工前 spike（必须）：** 执行者先 clone `https://github.com/termux/termux-app`，将 `terminal-emulator` 与 `terminal-view` 两个模块复制进 `app/`，在 `settings.gradle.kts` include，确认能编译。然后写一个最小 Activity 验证：构造 `TerminalEmulator`（不接 PTY，columns/rows 固定）、`emulator.append(bytes, len)` 喂入一段含 ANSI 颜色的字节、`TerminalView` 能渲染。确认 `TerminalSession`/`TerminalEmulator` 的实际构造签名（随 Termux 版本变化），据此细化下列任务的精确代码。

- **Task 10:** vendored terminal-emulator/terminal-view 模块接入，app 依赖之，编译通过。
- **Task 11:** `TerminalBridge`——把 HostMsg.Output 的 base64 解码字节 `append` 给 emulator；把 TerminalView 的按键/文本输入编码为 `ClientMsg.Input`(base64) 发回。纯逻辑部分（base64 编解码、输入→bytes）可单测。
- **Task 12:** `TerminalScreen` Composable——`AndroidView` 包 `TerminalView`，attach 时发 `ClientMsg.Attach(sessionId, cols, rows)`，离开发 `Detach`；接收 output 写入 emulator 并刷新。
- **Task 13:** 真机验收：手机打开一个会话，能看到 Claude Code 画面、能打字、回车发送、看到流式输出。

## M6：前台服务 + 本地通知

- **Task 14:** `ConnectionService`（前台服务，`lifecycle-service`）——把 WebSocket 连接从 Activity 迁入服务，Activity 绑定服务取状态。加 `FOREGROUND_SERVICE`、`POST_NOTIFICATIONS`(Android 13+) 权限与运行时申请。
- **Task 15:** `Notifications`——收到 `HostMsg.Event(kind=stop)` 发"会话等待输入"通知、`kind=permission_request` 发"请求授权"通知；点击通知 `PendingIntent` 打开对应会话的终端页。建通知渠道。
- **Task 16:** 真机验收：app 退后台，电脑上 Claude 干完活/请求权限，手机收到通知，点击直达会话。引导关闭该 app 的电池优化。

## M7：快捷键栏与打磨

- **Task 17:** 终端页底部快捷键栏（回车/ESC/↑↓/Tab/Ctrl/数字 1-3/打断 Ctrl+C），按键映射为控制字节经 Input 发送。
- **Task 18:** 转屏与软键盘弹出时重算 cols/rows 发 `Resize`；断线指数退避自动重连 + 重连后重新 attach 当前会话。
- **Task 19:** 体验打磨：新建会话时让用户输入 cwd（而非硬编码）、连接错误 toast、会话 kill 确认、深色主题终端配色。真机整体回归。

---

## 自检（针对 M4 详细部分）

- **协议覆盖：** auth/list/create/attach/input/resize/detach/kill 与 auth_ok/sessions/created/output/event/error 均在 Protocol.kt 建模；M4 用到 auth/list/create + auth_ok/sessions/created/error，attach/input/resize/detach/kill 在 M5/M7 用到，已全部定义。
- **类型一致：** SessionDto(id,name,cwd,state,createdAt,orphaned) 与宿主 `manager.list()` 输出字段一致；Session 领域模型字段同名。ClientMsg/HostMsg 命名在 Task 2–8 一致引用。
- **占位扫描：** M4（Task 1–9）每步含完整代码/命令，无 TBD。M5–M7 明确标注为"路线 + spike 后细化"，非占位遗漏，而是有意的分阶段（理由见"里程碑与执行说明"）。
- **已知风险：** Termux 模块的精确 API 随版本变化，M5 spike 用于锁定；无线 adb 端口在设备重启后变化需重连（Task 6 README 记录）。
```
