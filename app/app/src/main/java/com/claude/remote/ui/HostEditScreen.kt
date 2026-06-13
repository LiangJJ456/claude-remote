package com.claude.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * 新增/编辑一台电脑。isNew 时无删除按钮。
 */
@Composable
fun HostEditScreen(
    isNew: Boolean,
    initialName: String,
    initialUrl: String,
    initialToken: String,
    onSave: (name: String, url: String, token: String) -> Unit,
    onCancel: () -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var name by remember(initialName) { mutableStateOf(initialName) }
    var url by remember(initialUrl) { mutableStateOf(initialUrl.ifBlank { "ws://" }) }
    var token by remember(initialToken) { mutableStateOf(initialToken) }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(if (isNew) "新增电脑" else "编辑电脑", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(name, { name = it }, label = { Text("名称，如 家里台式机") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(url, { url = it }, label = { Text("地址 (ws://IP:端口)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(token, { token = it }, label = { Text("Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) { Text("取消") }
            Button(
                onClick = { if (name.isNotBlank() && url.isNotBlank() && token.isNotBlank()) onSave(name.trim(), url.trim(), token.trim()) },
                modifier = Modifier.weight(1f),
            ) { Text("保存") }
        }
        if (!isNew && onDelete != null) {
            TextButton(onClick = onDelete, modifier = Modifier.fillMaxWidth()) {
                Text("删除这台电脑", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
