package com.claude.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
    onNew: (String) -> Unit,
    onSettings: () -> Unit,
) {
    var showNewDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("会话 · $connState") }, actions = {
            TextButton(onClick = onSettings) { Text("设置") }
        }) },
        floatingActionButton = { FloatingActionButton(onClick = { showNewDialog = true }) { Text("+") } },
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

    if (showNewDialog) {
        NewSessionDialog(
            onConfirm = { cwd -> showNewDialog = false; onNew(cwd) },
            onDismiss = { showNewDialog = false },
        )
    }
}

@Composable
private fun NewSessionDialog(onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var cwd by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建会话") },
        text = {
            Column {
                Text("在哪个目录启动 Claude Code？填电脑上的绝对路径。", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = cwd,
                    onValueChange = { cwd = it },
                    label = { Text("目录，如 C:\\Users\\you\\proj") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { if (cwd.isNotBlank()) onConfirm(cwd.trim()) }) { Text("新建") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
