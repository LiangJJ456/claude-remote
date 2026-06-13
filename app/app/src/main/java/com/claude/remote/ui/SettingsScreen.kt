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
