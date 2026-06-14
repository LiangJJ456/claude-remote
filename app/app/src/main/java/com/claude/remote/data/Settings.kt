package com.claude.remote.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

private val Context.dataStore by preferencesDataStore(name = "settings")

/** 一台电脑（宿主）的配置。 */
@Serializable
data class HostEntry(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val url: String,
    val token: String,
)

/**
 * 多电脑设置。host 列表以 JSON 存于 DataStore。
 * 兼容旧版单 host 配置（host_url/token）：首次读取时迁移为列表中的一项。
 */
class Settings(private val context: Context) {
    private val KEY_HOSTS = stringPreferencesKey("hosts_json")
    private val KEY_OLD_URL = stringPreferencesKey("host_url")
    private val KEY_OLD_TOKEN = stringPreferencesKey("token")
    private val json = Json { ignoreUnknownKeys = true }

    val hosts: Flow<List<HostEntry>> = context.dataStore.data.map { prefs ->
        val raw = prefs[KEY_HOSTS]
        if (raw != null) {
            runCatching { json.decodeFromString<List<HostEntry>>(raw) }.getOrDefault(emptyList())
        } else {
            // 迁移旧单 host 配置
            val url = prefs[KEY_OLD_URL]; val token = prefs[KEY_OLD_TOKEN]
            if (!url.isNullOrBlank() && !token.isNullOrBlank()) {
                // 固定 id，避免每次读取生成新 UUID 导致连接重复/选中漂移
                listOf(HostEntry(id = "migrated-default", name = "我的电脑", url = url, token = token))
            } else emptyList()
        }
    }

    private suspend fun writeHosts(list: List<HostEntry>) {
        context.dataStore.edit { it[KEY_HOSTS] = json.encodeToString(list) }
    }

    suspend fun addHost(name: String, url: String, token: String): HostEntry {
        val entry = HostEntry(name = name.trim(), url = url.trim(), token = token.trim())
        writeHosts(currentList() + entry)
        return entry
    }

    suspend fun updateHost(id: String, name: String, url: String, token: String) {
        writeHosts(currentList().map {
            if (it.id == id) it.copy(name = name.trim(), url = url.trim(), token = token.trim()) else it
        })
    }

    suspend fun removeHost(id: String) {
        writeHosts(currentList().filterNot { it.id == id })
    }

    private suspend fun currentList(): List<HostEntry> = hosts.first()
}
