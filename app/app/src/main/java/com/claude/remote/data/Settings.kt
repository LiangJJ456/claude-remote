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
